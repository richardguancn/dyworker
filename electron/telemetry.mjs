import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createTelemetryStore } from "./telemetry-store.mjs";

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

// 带状态码的错误：控制器据 401/403 走凭据轮换（同 installation_id 重新登记换发）
function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function fetchJson(fetchImpl, url, { method = "GET", token = "", body, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
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
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

function responseData(result) {
  // 平台统一 code/message/data 包装；code 为 0/200/null 视为业务成功
  const payload = result.payload;
  if (payload && typeof payload === "object" && "data" in payload) {
    const code = payload.code;
    if (code !== 0 && code !== 200 && code !== null && code !== undefined) return null;
    return payload.data && typeof payload.data === "object" ? payload.data : {};
  }
  return payload && typeof payload === "object" ? payload : null;
}

// ---- 设备登记客户端 ----

export function createInstallationClient({ fetchImpl = (...args) => fetch(...args), now = () => Date.now(), log = () => {} } = {}) {
  let baseUrl = "";
  let token = "";
  let clockOffsetMs = null;
  let revoked = false;

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
    async register({ installationId, appVersion, platform, arch, releaseChannel, statsEnabled, messagesEnabled }) {
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/register"), {
        method: "POST",
        body: {
          installation_id: installationId,
          app_version: appVersion,
          platform,
          arch,
          release_channel: releaseChannel,
          stats_enabled: statsEnabled === true,
          messages_enabled: messagesEnabled === true,
        },
      });
      if (!result.ok) throw new Error(`设备登记失败：HTTP ${result.status}`);
      const data = responseData(result);
      const nextToken = String(data?.token || data?.device_token || "");
      if (!nextToken) throw new Error("设备登记响应缺少凭据");
      noteServerTime(data?.server_time || data?.now);
      token = nextToken;
      revoked = false;
      return { token: nextToken };
    },
    async syncPreferences({ statsEnabled, messagesEnabled, consentGeneration }) {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/installations/preferences"), {
        method: "PUT",
        token,
        body: {
          stats_enabled: statsEnabled === true,
          messages_enabled: messagesEnabled === true,
          consent_generation: Math.max(0, Math.floor(Number(consentGeneration) || 0)),
        },
      });
      if (!result.ok) throw new Error(`同步运营设置失败：HTTP ${result.status}`);
      noteServerTime(responseData(result)?.server_time);
      return true;
    },
    async uploadBatch(events) {
      if (!token) throw new Error("尚未完成设备登记");
      const result = await fetchJson(fetchImpl, url("/api/v1/dyworker/telemetry/batches"), {
        method: "POST",
        token,
        body: { events },
        timeoutMs: 30_000,
      });
      if (!result.ok) throw httpError(`统计上报失败：HTTP ${result.status}`, result.status);
      const data = responseData(result);
      noteServerTime(data?.server_time);
      const results = Array.isArray(data?.results) ? data.results : [];
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
      // 兼容不带逐条结果的成功响应：全部按已接受处理
      if (!results.length) {
        return { accepted: events.map((event) => event.event_id), duplicate: [], rejected: [] };
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
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  monotonicNow = () => performance.now(),
  onRegistered = () => {},
  log = () => {},
}) {
  const dir = String(userDataDir || "");
  const stateFile = path.join(dir, "telemetry-state.json");
  const credentialsFile = path.join(dir, "telemetry-credentials.json");
  const store = createTelemetryStore({ file: path.join(dir, "telemetry-queue.json"), now });
  const client = createInstallationClient({ fetchImpl, now, log });

  let settings = null;
  // 上一次 configure 后统计是否处于有效开启：标量快照，调用方原地修改设置对象也不影响判断
  let lastStatsOn = false;
  let configuredOnce = false;
  let state = { installation_id: crypto.randomUUID(), created_at: new Date(now()).toISOString(), consent_generation: 0 };
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
      try {
        const raw = JSON.parse(await fs.readFile(stateFile, "utf8"));
        if (raw && typeof raw === "object" && /^[0-9a-f-]{36}$/i.test(String(raw.installation_id || ""))) {
          state = {
            installation_id: String(raw.installation_id),
            created_at: String(raw.created_at || state.created_at),
            consent_generation: Math.max(0, Math.floor(Number(raw.consent_generation) || 0)),
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
  const serviceUrl = () => String(telemetrySettings().serviceUrl || "").trim();
  const effectiveStats = () => telemetrySettings().statsEnabled === true && serviceUrl().length > 0;
  const effectiveMessages = () => telemetrySettings().messagesEnabled === true && serviceUrl().length > 0;

  async function ensureRegistered() {
    await loadStateOnce();
    client.configure(serviceUrl());
    if (client.getToken() && !client.isRevoked()) return;
    const { token } = await client.register({
      installationId: state.installation_id,
      appVersion,
      platform,
      arch,
      releaseChannel,
      statsEnabled: effectiveStats(),
      messagesEnabled: effectiveMessages(),
    });
    await saveCredentials(token);
    try {
      onRegistered();
    } catch {
      // 回调失败不影响登记结果
    }
  }

  async function syncPreferences() {
    await ensureRegistered();
    await client.syncPreferences({
      statsEnabled: effectiveStats(),
      messagesEnabled: effectiveMessages(),
      consentGeneration: state.consent_generation,
    });
    preferencesDirty = false;
    lastSyncAt = new Date(now()).toISOString();
    lastError = "";
  }

  function startTracker() {
    if (tracker) return;
    tracker = createActivityTracker({ now, monotonicNow, appVersion, platform, arch, releaseChannel });
  }

  // 关闭统计本地立即生效：停止采集、清空待发送队列；在途请求的迟到确认对空队列无副作用
  function stopTracker() {
    if (!tracker) return;
    tracker.seal("stats-disabled");
    tracker = null;
    void store.clear();
  }

  async function flushOnce() {
    if (!effectiveStats() || !client.getToken() || uploadInFlight) return { ok: false, skipped: true };
    uploadInFlight = true;
    try {
      if (preferencesDirty) await syncPreferences();
      if (!client.getToken()) return { ok: false, error: "未登记设备" };
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
    } catch (error) {
      // 凭据失效（401/403）：以同一 installation_id 重新登记换发凭据，
      // 本批事件保持原 event_id 留在队列里下一周期重试
      if (error?.status === 401 || error?.status === 403) {
        client.setToken("");
        try {
          await ensureRegistered();
          await syncPreferences();
          const retry = await client.uploadBatch(await store.pending(200));
          await store.acknowledge({ accepted: retry.accepted.concat(retry.duplicate), rejected: retry.rejected });
          lastError = "";
          lastSyncAt = new Date(now()).toISOString();
          return { ok: true, uploaded: retry.accepted.length + retry.duplicate.length, rejected: retry.rejected.length };
        } catch (rotateError) {
          lastError = rotateError instanceof Error ? rotateError.message : String(rotateError);
          log(`[telemetry] ${lastError}`);
          return { ok: false, error: lastError };
        }
      }
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

  async function heartbeatOnce() {
    if (!client.getToken() || client.isRevoked()) return;
    if (!effectiveStats() && !effectiveMessages()) return;
    try {
      await client.heartbeat({ appVersion, platform });
    } catch (error) {
      log(`[telemetry] ${error instanceof Error ? error.message : String(error)}`);
    }
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
      settings = nextSettings;
      await loadStateOnce();
      const statsWasOn = configuredOnce && lastStatsOn;
      const statsNowOn = effectiveStats();
      const anyOn = statsNowOn || effectiveMessages();
      client.configure(serviceUrl());
      // 统计开关翻转推进授权代次；服务端据此拒绝旧代次批次。先推进再同步，
      // 保证 PUT 带的就是新代次。启动时首次 configure：全新安装首次开启推进到 1，
      // 重启恢复已开启的状态不重复推进（代次已大于 0）。
      if (statsNowOn && !statsWasOn && !(configuredOnce === false && state.consent_generation > 0)) {
        state.consent_generation += 1;
        await persistState();
      } else if (statsWasOn && !statsNowOn) {
        state.consent_generation += 1;
        await persistState();
      }
      if (anyOn) {
        // 开启任一联网运营功能即发生设备登记；偏好（授权代次）随后同步。
        // 断网时登记失败只记录错误，本地功能不受影响，下一周期重试。
        try {
          await ensureRegistered();
          await syncPreferences();
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          log(`[telemetry] ${lastError}`);
        }
      }
      if (!statsWasOn && statsNowOn) {
        startTracker();
      } else if (statsWasOn && !statsNowOn) {
        // 关闭统计本地立即生效：停采集、清空待发送队列
        stopTracker();
        preferencesDirty = true;
        // 重连后先同步关闭设置再进行任何上传（断网关闭也先本地生效）
        if (anyOn) void syncPreferences().catch(() => {});
      } else if (statsNowOn && !tracker) {
        startTracker();
      }
      lastStatsOn = statsNowOn;
      configuredOnce = true;
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
      if (preferencesDirty) void syncPreferences().then(() => flushOnce()).catch(() => {});
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
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1_000);
          timer.unref?.();
        }),
      ]);
    },
    // 「删除此安装已上传数据」：撤销凭据并触发服务端删除流程，本地队列与凭据一并清除
    async deleteInstallationData() {
      await loadStateOnce();
      if (!client.getToken()) {
        await store.clear();
        await clearCredentials();
        return { ok: true, deleted: false };
      }
      client.configure(serviceUrl());
      await client.deleteInstallation();
      await store.clear();
      await clearCredentials();
      preferencesDirty = true;
      return { ok: true, deleted: true };
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
