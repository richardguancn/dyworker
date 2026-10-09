import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createTelemetryStore } from "./telemetry-store.mts";
import { normalizeTelemetryServiceUrl } from "./settings.mts";

// DYWorker 使用统计桌面端（方案《APP使用统计与消息推送实施方案-2026-09-24》§4/§7.2）。
// 本文件包含三部分：
// 1) createActivityTracker：前台有效使用时长的活动状态机（可注入时钟，纯逻辑可测）；
// 2) createInstallationClient：设备登记/凭据/偏好/心跳/删除的 HTTP 客户端；
// 3) createTelemetryController：编排本地队列、上报循环、心跳与设置热切换。
// 服务端（安全监管平台）不在本项目实现，客户端按方案约定的接口对接。

export const SCHEMA_VERSION = 1;
export const METRIC_VERSION = 1;
export const IDLE_TIMEOUT_MS = 120_000;
export const TICK_MS = 5_000;
export const CHECKPOINT_MS = 15_000;
export const MAX_GAP_MS = 15_000;
export const MAX_INTERVAL_MS = 300_000;
export const UPLOAD_INTERVAL_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_JITTER_MS = 10_000;
export const REPORT_TIMEZONE = "Asia/Shanghai";

// ---- 上海时区的报表日期与午夜边界（上海无夏令时，固定 +08:00）----

const shanghaiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function shanghaiDayKey(epochMs) {
  return shanghaiFormatter.format(new Date(epochMs));
}

export function nextShanghaiMidnightUtc(epochMs) {
  const day = shanghaiDayKey(epochMs);
  return Date.parse(`${day}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
}

// 把 [start, end) 按上海日期切成多段；跨天区间必须拆开，日期归属用段起点。
export function splitIntervalByDay(startMs, endMs) {
  const segments = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const boundary = nextShanghaiMidnightUtc(cursor);
    const stop = Math.min(endMs, boundary);
    if (stop > cursor) segments.push({ start: cursor, end: stop });
    cursor = stop;
  }
  return segments;
}

// ---- 活动状态机 ----
// 只有业务窗口可见、未最小化、处于前台且近期有人工交互才计时；
// 默认连续 120 秒无应用内人工交互即停止计时（含交互后的静态阅读宽限）；
// 后台、锁屏、睡眠、退出、电脑操控立即结束区间；
// 单调时钟算时长，墙上时间定位报表日期；两次检查间隔异常时保守丢弃不确定间隔。
export function createActivityTracker({
  now = () => Date.now(),
  monotonicNow = () => performance.now(),
  appVersion = "",
  platform = process.platform,
  arch = process.arch,
  releaseChannel = "stable",
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  maxGapMs = MAX_GAP_MS,
  checkpointMs = CHECKPOINT_MS,
  maxIntervalMs = MAX_INTERVAL_MS,
}) {
  const runId = crypto.randomUUID();
  let seq = 0;
  let windowState = { visible: true, minimized: false, focused: true };
  let foregroundSince = null; // { wall, mono }
  let lastInteraction = null; // { wall, mono }
  let suspended = false;
  let locked = false;
  let automationActive = false;
  let openInterval = null; // { startWall, startMono, confirmedWall, confirmedMono, flags: Set }
  let anchors = null; // 上次确认 tick 的 { wall, mono }
  let activityEmitted = false;

  const isForeground = () => windowState.visible && !windowState.minimized && windowState.focused;

  function baseEvent(type, occurredWall) {
    seq += 1;
    return {
      type,
      event_id: crypto.randomUUID(),
      run_id: runId,
      seq,
      schema_version: SCHEMA_VERSION,
      metric_version: METRIC_VERSION,
      app_version: String(appVersion || ""),
      platform: String(platform || ""),
      arch: String(arch || ""),
      release_channel: String(releaseChannel || "stable"),
      occurred_at: new Date(occurredWall).toISOString(),
      date: shanghaiDayKey(occurredWall),
      timezone: REPORT_TIMEZONE,
      quality_flags: [],
    };
  }

  function intervalEvents(startWall, endWall, flags) {
    const flagList = [...new Set(flags)];
    return splitIntervalByDay(startWall, endWall).map((segment) => ({
      ...baseEvent("usage_interval", segment.start),
      started_at: new Date(segment.start).toISOString(),
      ended_at: new Date(segment.end).toISOString(),
      duration_ms: Math.round(segment.end - segment.start),
      quality_flags: flagList,
    }));
  }

  function sealInternal(endWall, reason) {
    if (!openInterval) return [];
    const stop = Math.max(endWall, openInterval.startWall);
    const events = intervalEvents(openInterval.startWall, stop, [...openInterval.flags, reason]);
    openInterval = null;
    return events;
  }

  // floor：封口后立刻续开新区间时，新起点不得早于封口边界（跨天/封顶续跑用）
  function tryOpen(nowWall, nowMono, floor = null) {
    if (openInterval || suspended || locked || automationActive || !isForeground() || !lastInteraction) return;
    if (nowMono - lastInteraction.mono > idleTimeoutMs) return;
    // 区间起点取「开始前台」与「首次合格交互」中较晚者：切到前台前的交互不追溯计时
    let anchor = foregroundSince && foregroundSince.mono >= lastInteraction.mono
      ? foregroundSince
      : lastInteraction;
    if (floor && floor.wall > anchor.wall) anchor = floor;
    openInterval = {
      startWall: anchor.wall,
      startMono: anchor.mono,
      confirmedWall: anchor.wall,
      confirmedMono: anchor.mono,
      flags: new Set(),
    };
  }

  const tracker = {
    runId,
    noteInteraction() {
      const wall = now();
      const mono = monotonicNow();
      lastInteraction = { wall, mono };
      tryOpen(wall, mono);
      // 首个合格交互立即产出轻量 app_activity，短暂使用也能计入日活
      if (openInterval && !activityEmitted && isForeground() && !suspended && !locked && !automationActive) {
        activityEmitted = true;
        return [baseEvent("app_activity", wall)];
      }
      return [];
    },
    noteWindowState(next) {
      windowState = {
        visible: next.visible !== false,
        minimized: next.minimized === true,
        focused: next.focused !== false,
      };
      if (isForeground()) {
        if (!foregroundSince) foregroundSince = { wall: now(), mono: monotonicNow() };
        return [];
      }
      foregroundSince = null;
      // 后台/最小化/失焦立即封口（封在最后确认的进度点）
      return sealInternal(openInterval ? openInterval.confirmedWall : now(), "background");
    },
    noteSuspend() {
      suspended = true;
      return sealInternal(openInterval ? openInterval.confirmedWall : now(), "suspend");
    },
    noteLocked() {
      locked = true;
      return sealInternal(openInterval ? openInterval.confirmedWall : now(), "locked");
    },
    noteUnlocked() {
      locked = false;
      anchors = null; // 解锁后重新锚定，不把锁屏间隔补记
      return [];
    },
    noteResume() {
      suspended = false;
      anchors = null; // 睡眠期间单调时钟与墙上时间可能脱钩，恢复后重新锚定
      lastInteraction = null; // 恢复后需要新的人工交互才算活跃
      return [];
    },
    // 电脑操控进行期间保守暂停人工计时，避免把自动输入算成人工；
    // 结束后需要新的人工交互才重新计时（不自动续期旧交互的阅读宽限）
    setAutomationActive(active) {
      automationActive = active === true;
      if (automationActive) {
        lastInteraction = null;
        return sealInternal(openInterval ? openInterval.confirmedWall : now(), "automation");
      }
      return [];
    },
    tick() {
      const nowWall = now();
      const nowMono = monotonicNow();
      if (suspended || locked || automationActive) {
        anchors = { wall: nowWall, mono: nowMono };
        return [];
      }
      let events = [];
      if (anchors) {
        const monoDelta = nowMono - anchors.mono;
        const wallDelta = nowWall - anchors.wall;
        // 检查间隔超限或墙/单调时钟脱钩：没有连续状态证据，保守丢弃该间隔
        if (monoDelta > maxGapMs + TICK_MS || Math.abs(wallDelta - monoDelta) > maxGapMs) {
          if (openInterval) {
            openInterval.flags.add(monoDelta > maxGapMs + TICK_MS ? "uncertain-gap-dropped" : "clock-anomaly");
            events = sealInternal(openInterval.confirmedWall, "anomaly");
          }
          anchors = { wall: nowWall, mono: nowMono };
          lastInteraction = null;
          return events;
        }
      }
      anchors = { wall: nowWall, mono: nowMono };
      if (openInterval) {
        const idleAt = lastInteraction ? lastInteraction.wall + idleTimeoutMs : 0;
        if (!isForeground() || !lastInteraction || nowWall >= idleAt) {
          // 静态阅读宽限结束：区间停在最后一次交互 + 宽限时长，而不是停在 tick 时刻
          events = sealInternal(Math.min(idleAt || openInterval.confirmedWall, nowWall), "idle");
        } else {
          openInterval.confirmedWall = nowWall;
          openInterval.confirmedMono = nowMono;
          const interval = openInterval;
          const elapsedMono = nowMono - interval.startMono;
          const midnight = nextShanghaiMidnightUtc(interval.startWall);
          let floor = null;
          if (nowWall >= midnight) {
            events = sealInternal(midnight, "day-cross");
            floor = { wall: midnight, mono: interval.startMono + (midnight - interval.startWall) };
          } else if (elapsedMono >= maxIntervalMs) {
            // 长区间最多每 5 分钟封口一次
            const capWall = interval.startWall + maxIntervalMs;
            events = sealInternal(capWall, "capped");
            floor = { wall: capWall, mono: interval.startMono + maxIntervalMs };
          } else if (elapsedMono >= checkpointMs) {
            // 每 15 秒封口一次已确认进度：强杀进程时最多损失最后 15 秒
            events = sealInternal(nowWall, "checkpoint");
            floor = { wall: nowWall, mono: nowMono };
          }
          if (events.length) tryOpen(nowWall, nowMono, floor);
        }
      } else {
        tryOpen(nowWall, nowMono);
      }
      return events;
    },
    seal(reason = "manual") {
      return sealInternal(openInterval ? openInterval.confirmedWall : now(), reason);
    },
    status() {
      return {
        runId,
        active: Boolean(openInterval),
        foreground: isForeground(),
        suspended,
        locked,
        automationActive,
        lastInteractionAt: lastInteraction ? new Date(lastInteraction.wall).toISOString() : "",
        activityEmitted,
      };
    },
  };
  return tracker;
}

// ---- HTTP 基础 ----

// 认证失败保留状态码；已撤销设备不能通过重新登记自动恢复。
function httpError(message, status, retryAfterMs = null) {
  const error = new Error(message);
  error.status = status;
  error.retryAfterMs = retryAfterMs;
  return error;
}

async function fetchJson(fetchImpl, url, { method = "GET", token = "", body, timeoutMs = 15_000 } = {} as any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: any = { Accept: "application/json" };
    if (token) headers.Authorization = `Device ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, ok: response.ok, payload, retryAfter: response.headers?.get?.("Retry-After") || "" };
  } finally {
    clearTimeout(timer);
  }
}

function responseData(result) {
  // 平台统一 code/message/data 包装；code 为 0/200/null 视为业务成功
  const payload = result.payload;
  if (!payload || typeof payload !== "object") throw httpError("服务响应格式无效", result.status);
  if (payload.code != null && payload.code !== 0 && payload.code !== 200) throw httpError(String(payload.message || "服务请求失败"), payload.code);
  if (payload && typeof payload === "object" && "data" in payload) {
    const code = payload.code;
    if (code !== 0 && code !== 200 && code !== null && code !== undefined) return null;
    return payload.data && typeof payload.data === "object" ? payload.data : {};
  }
  return payload && typeof payload === "object" ? payload : null;
}

// ---- 设备登记客户端 ----

export function createInstallationClient({ fetchImpl = (url, init) => fetch(url, init), now = () => Date.now(), log = (_msg) => {} } = {} as any) {
  let baseUrl = "";
  let token = "";
  let clockOffsetMs = null;
  let revoked = false;
  let generation = 0;

  const url = (suffix) => `${baseUrl.replace(/\/+$/, "")}${suffix}`;

  function noteServerTime(value) {
    const serverMs = value ? (typeof value === "number" ? value : Date.parse(value)) : NaN;
    if (!Number.isFinite(serverMs)) return;
    const offset = serverMs - now();
    // 只在偏差显著时记录（小于 2 秒视为正常网络延迟）
    clockOffsetMs = Math.abs(offset) > 2_000 ? Math.round(offset) : 0;
  }

  return {
    configure(nextBaseUrl) {
      baseUrl = String(nextBaseUrl || "");
    },
    setToken(nextToken) {
      token = String(nextToken || "");
      if (token) revoked = false;
    },
    getToken: () => token,
    isConfigured: () => baseUrl.length > 0,
    getBaseUrl: () => baseUrl,
    getClockOffsetMs: () => clockOffsetMs,
    markRevoked() {
      revoked = true;
      token = "";
    },
    isRevoked: () => revoked,
    resetRevocation() { revoked = false; },
    async register({ installationId, appVersion, platform, arch, releaseChannel, statsEnabled, messagesEnabled }) {
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/register"), {
        method: "POST",
        body: {
          installation_id: installationId,
          app_version: appVersion,
          platform,
          arch,
          release_channel: releaseChannel,
          telemetry_enabled: statsEnabled === true,
          messages_enabled: messagesEnabled === true,
        },
      });
      if (!result.ok) {
        let retryAfterMs = null;
        if (result.status === 429) {
          const header = String(result.retryAfter || "").trim();
          const seconds = /^\d+$/.test(header) ? Number(header) : Number(result.payload?.retry_after_seconds);
          const deadline = header && !/^\d+$/.test(header) ? Date.parse(header) : NaN;
          retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? Math.max(1_000, seconds * 1_000)
            : Number.isFinite(deadline) ? Math.max(1_000, deadline - now()) : 60 * 60_000;
        }
        throw httpError(result.status === 429 ? "设备登记请求过于频繁" : `设备登记失败：HTTP ${result.status}`, result.status, retryAfterMs);
      }
      const data = responseData(result);
      const nextToken = data?.device_secret && data?.installation_id === installationId ? `${installationId}.${data.device_secret}` : "";
      if (!nextToken) throw new Error("设备登记响应缺少凭据");
      noteServerTime(data?.server_time || data?.now);
      token = nextToken;
      revoked = false;
      generation = 1;
      return { token: nextToken };
    },
    async syncPreferences({ statsEnabled, messagesEnabled }) {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/preferences"), {
        method: "PUT",
        token,
        body: {
          telemetry_enabled: statsEnabled === true,
          messages_enabled: messagesEnabled === true,
        },
      });
      if (!result.ok) throw httpError(`同步运营设置失败：HTTP ${result.status}`, result.status);
      const data = responseData(result);
      if (!Number.isInteger(data?.generation) || data.generation < 1) throw new Error("设置同步响应缺少授权代次");
      generation = data.generation;
      noteServerTime(data.server_time);
      return generation;
    },
    async uploadBatch(events) {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/telemetry/batches"), {
        method: "POST",
        token,
        body: {
          schema_version: SCHEMA_VERSION, metric_version: METRIC_VERSION, consent_generation: generation,
          events: events.map(({ type, started_at, ended_at, ...event }) => ({
            ...event,
            event_type: type === "app_activity" ? "activity" : type === "usage_interval" ? "interval" : type,
            ...(started_at ? { interval_start: started_at, interval_end: ended_at } : {}),
          })),
        },
        timeoutMs: 30_000,
      });
      if (!result.ok) throw httpError(`统计上报失败：HTTP ${result.status}`, result.status);
      const data = responseData(result);
      noteServerTime(data?.server_time);
      if (!Array.isArray(data?.results)) throw new Error("统计响应缺少逐条确认，保留本地队列");
      const results = data.results;
      const accepted = [];
      const duplicate = [];
      const rejected = [];
      for (const item of results) {
        const id = String(item?.event_id || "");
        if (!id) continue;
        if (item.status === "accepted") accepted.push(id);
        else if (item.status === "duplicate") duplicate.push(id);
        else if (item.status === "rejected") rejected.push(id);
      }
      return { accepted, duplicate, rejected };
    },
    async heartbeat({ appVersion, platform }) {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/heartbeat"), {
        method: "POST",
        token,
        body: { app_version: appVersion, platform },
        timeoutMs: 10_000,
      });
      if (result.status === 401 || result.status === 403) throw httpError("设备凭据已失效", result.status);
      if (!result.ok) throw httpError(`心跳失败：HTTP ${result.status}`, result.status);
      responseData(result);
      return true;
    },
    async deleteInstallation() {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/me"), {
        method: "DELETE",
        token,
        timeoutMs: 15_000,
      });
      if (!result.ok) throw new Error(`删除安装数据失败：HTTP ${result.status}`);
      responseData(result);
      revoked = true;
      token = "";
      return true;
    },
    log,
  };
}

// ---- 控制器 ----

function jitter(scaleMs) {
  return Math.floor(Math.random() * scaleMs);
}

export function createTelemetryController({
  userDataDir,
  appVersion = "",
  platform = process.platform,
  arch = process.arch,
  releaseChannel = "stable",
  secretStorage = null,
  fetchImpl = (url, init) => fetch(url, init),
  now = () => Date.now(),
  monotonicNow = () => performance.now(),
  onRegistered = () => {},
  log = (_msg) => {},
}) {
  const dir = String(userDataDir || "");
  const stateFile = path.join(dir, "telemetry-state.json");
  const credentialsFile = path.join(dir, "telemetry-credentials.json");
  const store = createTelemetryStore({ file: path.join(dir, "telemetry-queue.json"), now });
  const client = createInstallationClient({ fetchImpl, now, log });

  let settings = null;
  // 上一次 configure 后统计是否处于有效开启：标量快照，调用方原地修改设置对象也不影响判断
  let state = { registration_retry_at: 0, registration_failures: 0, registration_error: "", registration_blocked: false, installation_id: crypto.randomUUID(), created_at: new Date(now()).toISOString(), consent_generation: 0, service_url: "", registered: false, revoked: false };
  let credentialMode = "none"; // safe-storage | session | none
  let tracker = null;
  let uploadTimer = null;
  let tickTimer = null;
  let heartbeatTimer = null;
  let uploadInFlight = false;
  let failures = 0;
  let backoffUntil = 0;
  let lastError = "";
  let lastSyncAt = "";
  let preferencesDirty = true;
  let stateLoaded = null;
  let started = false;
  let writeChain = Promise.resolve();
  let networkChain = Promise.resolve();
  let settingsRevision = 0;
  const networkTask = (task) => {
    const run = networkChain.then(task, task);
    networkChain = run.catch(() => {});
    return run;
  };

  function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  async function persistState() {
    await enqueueWrite(async () => {
      await fs.mkdir(dir, { recursive: true });
      const temporary = `${stateFile}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state), "utf8");
      await fs.rename(temporary, stateFile);
    });
  }

  function loadStateOnce() {
    stateLoaded ??= (async () => {
      let legacyUnboundState = false;
      try {
        const raw = JSON.parse(await fs.readFile(stateFile, "utf8"));
        if (raw && typeof raw === "object" && /^[0-9a-f-]{36}$/i.test(String(raw.installation_id || ""))) {
          legacyUnboundState = !Object.hasOwn(raw, "service_url");
          state = {
            installation_id: String(raw.installation_id) as any,
            created_at: String(raw.created_at || state.created_at),
            consent_generation: Math.max(0, Math.floor(Number(raw.consent_generation) || 0)),
            service_url: String(raw.service_url || ""),
            registration_retry_at: Math.max(0, Number(raw.registration_retry_at) || 0),
            registration_failures: Math.max(0, Number(raw.registration_failures) || 0),
            registration_error: String(raw.registration_error || ""),
            registration_blocked: raw.registration_blocked === true || ["设备登记失败：HTTP 409", "平台已登记此安装，但本机缺少登记凭证，请联系管理员恢复原登记"].includes(raw.registration_error),
            registered: raw.registered === true,
            revoked: raw.revoked === true,
          };
        }
      } catch {
        // 首次运行或文件损坏时沿用新生成的 installation_id
      }
      try {
        const raw = JSON.parse(await fs.readFile(credentialsFile, "utf8"));
        const cipher = String(raw?.token || "");
        if (cipher && raw.encrypted === true && secretStorage?.isEncryptionAvailable?.()) {
          const plain = secretStorage.decryptString(Buffer.from(cipher, "base64"));
          if (plain) {
            client.setToken(plain);
            credentialMode = "safe-storage";
          }
        }
        // 明文落盘的历史脏数据不接受：要求重新登记
      } catch {
        // 凭据文件缺失时走重新登记
      }
      if (state.registration_blocked) {
        state.registration_error = "平台已登记此安装，但本机缺少登记凭证，请联系管理员恢复原登记";
        state.registration_retry_at = 0;
      }
      lastError = state.registration_error;
      // 旧版身份继续沿用，不能通过换 ID 绕过冲突或清掉待上传记录。
      // 未绑定服务的历史凭据不发送到新站点，缺失凭据需由管理员恢复原登记。
      if (legacyUnboundState) await clearCredentials();
    })();
    return stateLoaded;
  }

  async function saveCredentials(token) {
    if (secretStorage?.isEncryptionAvailable?.()) {
      const cipher = secretStorage.encryptString(token).toString("base64");
      await enqueueWrite(async () => {
        await fs.mkdir(dir, { recursive: true });
        const temporary = `${credentialsFile}.${process.pid}.tmp`;
        await fs.writeFile(temporary, JSON.stringify({ token: cipher, encrypted: true }), "utf8");
        await fs.rename(temporary, credentialsFile);
        await fs.chmod(credentialsFile, 0o600).catch(() => {});
      });
      credentialMode = "safe-storage";
      return;
    }
    // 安全存储不可用：凭据仅会话内保存，不明文落盘
    credentialMode = "session";
  }

  async function clearCredentials() {
    client.setToken("");
    credentialMode = "none";
    await enqueueWrite(async () => {
      await fs.rm(credentialsFile, { force: true }).catch(() => {});
    });
  }

  const telemetrySettings = () => settings?.telemetry || {};
  const serviceUrl = () => normalizeTelemetryServiceUrl(telemetrySettings().serviceUrl);
  const effectiveStats = () => telemetrySettings().statsEnabled === true && serviceUrl().length > 0;
  const effectiveMessages = () => telemetrySettings().messagesEnabled === true && serviceUrl().length > 0;

  async function ensureRegistered() {
    await loadStateOnce();
    if (state.revoked || client.isRevoked()) throw new Error("此设备已撤销，已停止联网，请联系管理员");
    if (client.getToken()) return;
    if (state.registered) throw new Error("无法读取此设备的安全凭据，请恢复系统安全存储后重试");
    if (state.registration_blocked) throw new Error("平台已登记此安装，但本机缺少登记凭证，请联系管理员恢复原登记");
    if (state.registration_retry_at > now()) throw new Error(state.registration_error || "设备登记暂缓，稍后自动重试");
    await persistState();
    let token;
    try {
      ({ token } = await client.register({
      installationId: state.installation_id,
      appVersion,
      platform,
      arch,
      releaseChannel,
      statsEnabled: effectiveStats(),
      messagesEnabled: effectiveMessages(),
      }));
    } catch (error: any) {
      state.registration_failures += 1;
      state.registration_blocked = error?.status === 409;
      const delay = error?.status === 429 ? (error.retryAfterMs || 60 * 60_000)
        : Math.min(60_000 * 2 ** Math.min(state.registration_failures - 1, 5), 30 * 60_000);
      state.registration_retry_at = state.registration_blocked ? 0 : now() + delay;
      state.registration_error = state.registration_blocked
        ? "平台已登记此安装，但本机缺少登记凭证，请联系管理员恢复原登记"
        : error instanceof Error ? error.message : String(error);
      await persistState();
      if (state.registration_blocked) throw new Error(state.registration_error);
      throw error;
    }
    state.registration_blocked = false;
    state.registration_retry_at = 0;
    state.registration_failures = 0;
    state.registration_error = "";
    await saveCredentials(token);
    state.registered = true;
    await persistState();
    try {
      onRegistered();
    } catch {
      // 回调失败不影响登记结果
    }
  }

  async function syncPreferences() {
    await ensureRegistered();
    const revision = settingsRevision;
    state.consent_generation = await client.syncPreferences({
      statsEnabled: effectiveStats(),
      messagesEnabled: effectiveMessages(),
    });
    await persistState();
    preferencesDirty = revision !== settingsRevision;
    lastSyncAt = new Date(now()).toISOString();
    lastError = "";
  }

  function startTracker() {
    if (tracker) return;
    tracker = createActivityTracker({ now, monotonicNow, appVersion, platform, arch, releaseChannel });
  }

  // 关闭统计本地立即生效：停止采集、清空待发送队列；在途请求的迟到确认对空队列无副作用
  function stopTracker() {
    tracker?.seal("stats-disabled");
    tracker = null;
    return store.clear();
  }

  async function flushInternal() {
    if (!effectiveStats() || state.revoked || uploadInFlight) return { ok: false, skipped: true };
    uploadInFlight = true;
    try {
      if (preferencesDirty) await syncPreferences();
      if (!effectiveStats() || preferencesDirty || !client.getToken()) return { ok: false, skipped: true };
      const events = await store.pending(200);
      if (!events.length) {
        failures = 0;
        backoffUntil = 0;
        return { ok: true, uploaded: 0 };
      }
      const result = await client.uploadBatch(events);
      await store.acknowledge({ accepted: result.accepted.concat(result.duplicate), rejected: result.rejected });
      failures = 0;
      backoffUntil = 0;
      lastError = "";
      lastSyncAt = new Date(now()).toISOString();
      return { ok: true, uploaded: result.accepted.length + result.duplicate.length, rejected: result.rejected.length };
    } catch (error: any) {
      if (error?.status === 401 || error?.status === 403) {
        await revokeLocal();
      }
      if (error?.status === 409) preferencesDirty = true;
      failures += 1;
      // 断网指数退避加随机抖动：60s 起步，封顶 30 分钟
      const delay = Math.min(UPLOAD_INTERVAL_MS * 2 ** (failures - 1), 30 * 60_000) + jitter(5_000);
      backoffUntil = now() + delay;
      lastError = error instanceof Error ? error.message : String(error);
      log(`[telemetry] ${lastError}`);
      return { ok: false, error: lastError };
    } finally {
      uploadInFlight = false;
    }
  }

  const flushOnce = () => networkTask(flushInternal);

  async function revokeLocal() {
    state.revoked = true;
    client.markRevoked();
    await stopTracker();
    await clearCredentials();
    await persistState();
  }

  async function heartbeatOnce() {
    return networkTask(async () => {
      if (state.revoked || !serviceUrl()) return;
      if (!effectiveStats() && !effectiveMessages() && !(preferencesDirty && client.getToken())) return;
      try {
        if (preferencesDirty) await syncPreferences();
        if (effectiveStats() || effectiveMessages()) await client.heartbeat({ appVersion, platform });
      } catch (error: any) {
        if (error?.status === 401) await revokeLocal();
        lastError = error instanceof Error ? error.message : String(error);
        log(`[telemetry] ${lastError}`);
      }
    });
  }

  function scheduleHeartbeat(controller) {
    // 心跳默认 60 秒并加抖动错峰；单次失败不重试，下一周期自然覆盖
    heartbeatTimer = setTimeout(() => {
      void heartbeatOnce().finally(() => {
        if (started) scheduleHeartbeat(controller);
      });
    }, HEARTBEAT_INTERVAL_MS + jitter(HEARTBEAT_JITTER_MS));
    heartbeatTimer.unref?.();
  }

  const controller = {
    store,
    client,
    async configure(nextSettings) {
      const previousUrl = serviceUrl();
      settings = { ...nextSettings, telemetry: { ...nextSettings?.telemetry } };
      const revision = ++settingsRevision;
      preferencesDirty = true;
      // 本地停采集不等待任何网络请求完成。
      if (!effectiveStats() || (previousUrl && previousUrl !== serviceUrl())) await stopTracker();
      await loadStateOnce();
      return networkTask(async () => {
        if (revision !== settingsRevision) return;
        const nextUrl = serviceUrl();
        if (nextUrl && state.service_url && state.service_url !== nextUrl) {
          await clearCredentials();
          await store.clear();
          state = { registration_retry_at: 0, registration_failures: 0, registration_error: "", registration_blocked: false, installation_id: crypto.randomUUID(), created_at: new Date(now()).toISOString(),
            consent_generation: 0, service_url: nextUrl, registered: false, revoked: false };
          client.setToken("");
          client.resetRevocation();
        }
        if (nextUrl) state.service_url = nextUrl;
        client.configure(nextUrl);
        await persistState();
        if (effectiveStats() && !state.revoked) startTracker();
        if (!nextUrl || state.revoked) return;
        if (!effectiveStats() && !effectiveMessages() && !client.getToken()) return;
        try {
          await syncPreferences();
        } catch (error: any) {
          if (error?.status === 401) await revokeLocal();
          lastError = error instanceof Error ? error.message : String(error);
          log(`[telemetry] ${lastError}`);
        }
      });
    },
    start() {
      if (started) return;
      started = true;
      tickTimer = setInterval(() => this.tick(), TICK_MS);
      tickTimer.unref?.();
      uploadTimer = setInterval(() => {
        if (!effectiveStats() || backoffUntil > now()) return;
        void flushOnce();
      }, UPLOAD_INTERVAL_MS);
      uploadTimer.unref?.();
      scheduleHeartbeat(this);
    },
    stop() {
      started = false;
      if (tickTimer) clearInterval(tickTimer);
      if (uploadTimer) clearInterval(uploadTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      tickTimer = null;
      uploadTimer = null;
      heartbeatTimer = null;
    },
    // 供测试与主进程手动触发一次上报（定时器之外的能力）
    flushOnce,
    heartbeatOnce,
    // 渲染端人工活动信号：点击/按键/滚动节流后进入
    noteUserActivity() {
      if (!tracker || !effectiveStats()) return;
      const events = tracker.noteInteraction();
      if (events.length) void store.enqueue(events);
    },
    noteWindowState(next) {
      if (!tracker) return;
      const events = tracker.noteWindowState(next);
      if (events.length) void store.enqueue(events);
    },
    noteSuspend() {
      if (!tracker) return;
      const events = tracker.noteSuspend();
      if (events.length) void store.enqueue(events);
    },
    noteResume() {
      if (!tracker) return;
      tracker.noteResume();
      // 恢复联网后先同步偏好再上传，避免关闭统计后旧批次再发出
      void heartbeatOnce().then(() => flushOnce()).catch(() => {});
    },
    noteLocked() {
      if (!tracker) return;
      const events = tracker.noteLocked();
      if (events.length) void store.enqueue(events);
    },
    noteUnlocked() {
      tracker?.noteUnlocked();
    },
    setAutomationActive(active) {
      if (!tracker) return;
      const events = tracker.setAutomationActive(active);
      if (events.length) void store.enqueue(events);
    },
    tick() {
      if (!tracker) return;
      const events = tracker.tick();
      if (events.length) void store.enqueue(events);
    },
    // 退出路径：先落盘，网络尝试最长 1 秒，不等待统计服务器才允许退出
    async shutdown() {
      this.stop();
      if (tracker) {
        const events = tracker.seal("exit");
        tracker = null;
        if (events.length) await store.enqueue(events);
      }
      if (!effectiveStats() || !client.getToken()) return;
      await Promise.race([
        flushOnce(),
        new Promise<any>((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          timer.unref?.();
        }),
      ]);
    },
    // 「删除此安装已上传数据」：撤销凭据并触发服务端删除流程，本地队列与凭据一并清除
    async deleteInstallationData() {
      await loadStateOnce();
      return networkTask(async () => {
        const registered = Boolean(client.getToken());
        if (registered) await client.deleteInstallation();
        await revokeLocal();
        preferencesDirty = false;
        return { ok: true, deleted: registered };
      });
    },
    async status() {
      await loadStateOnce();
      const queueStats = await store.stats();
      return {
        configured: serviceUrl().length > 0,
        serviceUrl: serviceUrl(),
        statsEnabled: effectiveStats(),
        messagesEnabled: effectiveMessages(),
        registered: Boolean(client.getToken()) && !client.isRevoked(),
        credentialMode,
        installationId: state.installation_id,
        consentGeneration: state.consent_generation,
        queue: queueStats,
        lastSyncAt,
        lastError,
        nextRegistrationRetryAt: !client.getToken() && state.registration_retry_at > now()
          ? new Date(state.registration_retry_at).toISOString() : "",
        clockOffsetMs: client.getClockOffsetMs(),
        collecting: Boolean(tracker),
      };
    },
    getInstallationId() {
      return state.installation_id;
    },
    // 供消息中心共享设备凭据与请求实现
    getClient() {
      return client;
    },
  };
  return controller;
}
