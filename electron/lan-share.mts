// 局域网用户发现与点对点文件传输核心服务：
// - 基于 Node 原生 dgram (UDP 广播) 自动发现同网段 DYWorker 设备，支持默认开启与隐身开关
// - 展示用户已登录账号（若有）、自定义昵称、设备名与系统平台
// - 基于 Node 原生 http 进行点对点请求确认（offer）、拒绝/同意回告（decision）、
//   一次性令牌流式文件下载（download + SHA-256 校验）与完成销毁（complete）
// - 严格限制仅限局域网/本机私网 IP 访问，拒绝公网来源
//
// 纯逻辑模块（不 import electron），便于双节点本地回环端到端测试。

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import dgram from "node:dgram";
import http from "node:http";
import os from "node:os";

export const LAN_SHARE_PROTOCOL = "dyworker-lan-share";
export const LAN_SHARE_PROTOCOL_VERSION = 1;
export const DEFAULT_DISCOVERY_PORT = Number(process.env.DYWORKER_LAN_DISCOVERY_PORT) || 41234;
export const DEFAULT_HTTP_PORT = Number(process.env.DYWORKER_LAN_HTTP_PORT) || 41235;

export const HEARTBEAT_INTERVAL_MS = 5000;
export const PEER_TTL_MS = 16000;
export const OFFER_TTL_MS = 600_000;
export const MAX_CONTROL_JSON_BYTES = 64 * 1024;
export const MAX_SESSION_TRANSFER_BYTES = 512 * 1024 * 1024;
export const MAX_PLUGIN_TRANSFER_BYTES = 50 * 1024 * 1024;

export type LanShareKind = "session" | "project" | "plugin";

export interface LanIdentity {
  deviceId: string;
  displayName: string;
  account: string;
  host: string;
  platform: string;
  appVersion: string;
}

export interface LanPeerRecord {
  deviceId: string;
  displayName: string;
  account: string;
  host: string;
  platform: string;
  appVersion: string;
  ip: string;
  httpPort: number;
  lastSeenAt: number;
}

export interface LanIncomingOffer {
  transferId: string;
  kind: LanShareKind;
  title: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  downloadToken: string;
  senderIp: string;
  sender: {
    deviceId: string;
    displayName: string;
    account: string;
    host: string;
    platform: string;
    httpPort: number;
  };
  meta: Record<string, any>;
  receivedAt: number;
  expiresAt: number;
}

export type LanOutgoingStatus = "waiting" | "transferring" | "completed" | "rejected" | "cancelled" | "failed";

export interface LanOutgoingTransfer {
  transferId: string;
  peerId: string;
  peerName: string;
  kind: LanShareKind;
  title: string;
  fileName: string;
  sizeBytes: number;
  status: LanOutgoingStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export function normalizeIpAddress(raw: string | undefined | null): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("::ffff:")) return value.slice(7);
  const zoneIdx = value.indexOf("%");
  return zoneIdx > 0 ? value.slice(0, zoneIdx) : value;
}

/** 仅允许环回地址与 RFC1918 / Link-Local / IPv6 ULA 私网地址 */
export function isPrivateLanAddress(rawIp: string | undefined | null): boolean {
  const ip = normalizeIpAddress(rawIp);
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1") return true;

  // IPv4 判断
  const ipv4Parts = ip.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((seg) => /^\d{1,3}$/.test(seg))) {
    const nums = ipv4Parts.map((seg) => Number(seg));
    if (nums.some((n) => n < 0 || n > 255)) return false;
    const [a, b] = nums;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  // IPv6 私网（ULA fc00::/7, Link-Local fe80::/10）
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  return false;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = String(ip || "").trim().split(".");
  if (parts.length !== 4 || !parts.every((seg) => /^\d{1,3}$/.test(seg))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

export function collectLocalLanInterfaces(): Array<{ address: string; netmask: string }> {
  const result: Array<{ address: string; netmask: string }> = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list || []) {
      if (!info || info.internal || info.family !== "IPv4") continue;
      const addr = normalizeIpAddress(info.address);
      if (addr) result.push({ address: addr, netmask: String(info.netmask || "") });
    }
  }
  return result;
}

export function collectLocalLanIpv4s(): string[] {
  return [...new Set(collectLocalLanInterfaces().map((item) => item.address))];
}

/**
 * 判定局域网节点 IP 是否允许通信：
 * - 放行标准私网（RFC1918 / Loopback / Link-Local / IPv6 ULA）及 CGNAT (100.64.0.0/10)
 * - 放行用户显式添加直连的节点 IP
 * - 放行与本机任一局域网网卡同子网或同 /16 企业园区网段（如 172.168.139.63 ↔ 172.168.138.154）
 */
export function isAllowedLanPeerAddress(
  rawIp: string | undefined | null,
  options: {
    localInterfaces?: Array<{ address: string; netmask?: string }>;
    trustedHosts?: Iterable<string>;
  } = {},
): boolean {
  const ip = normalizeIpAddress(rawIp);
  if (!ip) return false;
  if (isPrivateLanAddress(ip)) return true;

  if (options.trustedHosts) {
    for (const host of options.trustedHosts) {
      if (normalizeIpAddress(host) === ip) return true;
    }
  }

  const target = parseIpv4Octets(ip);
  if (!target) return false;
  const [ta, tb] = target;
  // CGNAT / Tailscale 等虚拟内网段 100.64.0.0/10
  if (ta === 100 && tb >= 64 && tb <= 127) return true;

  const locals = options.localInterfaces || collectLocalLanInterfaces();
  for (const iface of locals) {
    const local = parseIpv4Octets(normalizeIpAddress(iface.address));
    if (!local) continue;
    const mask = parseIpv4Octets(String(iface.netmask || ""));
    if (mask) {
      const sameSubnet = target.every((oct, idx) => (oct & mask[idx]) === (local[idx] & mask[idx]));
      if (sameSubnet) return true;
    }
    // 兼容使用非标内网 IP 段的多 VLAN 园区网络（如 172.168.139.x 与 172.168.138.x）
    if (ta === local[0] && tb === local[1]) return true;
  }

  return false;
}

export function parseManualPeerAddress(raw: string): { host: string; port?: number; normalized: string } | null {
  let value = String(raw || "").trim();
  if (!value) return null;
  value = value.replace(/^https?:\/\//i, "").split("/")[0].trim();
  if (!value) return null;

  let host = value;
  let port: number | undefined;
  const colonIdx = value.lastIndexOf(":");
  if (colonIdx > 0 && !value.includes("]")) {
    const hostPart = value.slice(0, colonIdx).trim();
    const portPart = value.slice(colonIdx + 1).trim();
    if (!/^\d{1,5}$/.test(portPart)) return null;
    const parsedPort = Number(portPart);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) return null;
    host = hostPart;
    port = parsedPort;
  }

  const cleanHost = normalizeIpAddress(host);
  const validIpv4 = Boolean(parseIpv4Octets(cleanHost));
  const validHostname = /^(?:localhost|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/.test(cleanHost);
  if (!validIpv4 && !validHostname) return null;

  return {
    host: cleanHost,
    ...(port ? { port } : {}),
    normalized: port ? `${cleanHost}:${port}` : cleanHost,
  };
}

export function resolveLocalIdentity(options: {
  deviceId?: string;
  nickname?: string;
  loginAccount?: string;
  hostname?: string;
  username?: string;
  platform?: string;
  appVersion?: string;
} = {}): LanIdentity {
  const account = String(options.loginAccount || "").trim().slice(0, 64);
  const nickname = String(options.nickname || "").trim().slice(0, 40);
  let systemUser = String(options.username || "").trim();
  if (!systemUser) {
    try {
      systemUser = String(os.userInfo().username || "").trim();
    } catch {
      systemUser = "";
    }
  }
  const host = String(options.hostname || os.hostname() || "").trim() || "本机";
  const displayName = nickname || account || systemUser || host || "DYWorker 用户";

  return {
    deviceId: String(options.deviceId || randomBytes(16).toString("hex")),
    displayName,
    account,
    host,
    platform: String(options.platform || process.platform),
    appVersion: String(options.appVersion || ""),
  };
}

function collectLanBroadcastTargets(): string[] {
  const targets = new Set<string>(["255.255.255.255"]);
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list || []) {
      if (!info || info.internal || info.family !== "IPv4") continue;
      const ipParts = info.address.split(".").map(Number);
      const maskParts = (info.netmask || "").split(".").map(Number);
      if (ipParts.length !== 4 || maskParts.length !== 4) continue;
      const bcast = ipParts.map((oct, idx) => (oct | (~maskParts[idx] & 255))).join(".");
      targets.add(bcast);
    }
  }
  return [...targets];
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readRequestJson(req: http.IncomingMessage, maxBytes = MAX_CONTROL_JSON_BYTES): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error("请求体过大"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error("无效的 JSON 请求体"));
      }
    });
    req.on("error", reject);
  });
}

function writeJsonResponse(res: http.ServerResponse, status: number, body: any) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function postJson(
  urlStr: string,
  body: any,
  timeoutMs = 10_000,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const raw = JSON.stringify(body);
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(raw),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total <= MAX_CONTROL_JSON_BYTES) chunks.push(chunk);
      });
      res.on("end", () => {
        let data: any = {};
        try {
          data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          data = {};
        }
        resolve({ status: res.statusCode || 500, data });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("局域网请求超时"));
    });
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

function getJson(urlStr: string, timeoutMs = 3000): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const req = http.get({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total <= MAX_CONTROL_JSON_BYTES) chunks.push(chunk);
      });
      res.on("end", () => {
        let data: any = {};
        try {
          data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          data = {};
        }
        resolve({ status: res.statusCode || 500, data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}

function downloadBinary(
  urlStr: string,
  maxBytes: number,
  timeoutMs = 120_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const req = http.get({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      timeout: timeoutMs,
    }, (res) => {
      if ((res.statusCode || 500) !== 200) {
        const errChunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          if (errChunks.length < 16) errChunks.push(chunk);
        });
        res.on("end", () => {
          let message = `下载失败（HTTP ${res.statusCode}）`;
          try {
            const parsedErr = JSON.parse(Buffer.concat(errChunks).toString("utf8"));
            if (parsedErr?.error) message = String(parsedErr.error);
          } catch {}
          reject(new Error(message));
        });
        return;
      }

      const contentLength = Number(res.headers["content-length"] || 0);
      if (contentLength > maxBytes) {
        res.destroy();
        reject(new Error("文件超过局域网传输大小限制"));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy();
          reject(new Error("文件超过局域网传输大小限制"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("局域网传输超时")));
    req.on("error", reject);
  });
}

interface OutgoingInternal {
  transfer: LanOutgoingTransfer;
  peerIp: string;
  peerHttpPort: number;
  downloadToken: string;
  sha256: string;
  payloadBuffer: Buffer | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface IncomingInternal {
  offer: LanIncomingOffer;
  timer: ReturnType<typeof setTimeout> | null;
  processing?: boolean;
}

export interface LanShareConfig {
  discoverable: boolean;
  nickname: string;
  loginAccount: string;
  manualPeers?: string[];
}

export interface LanShareServiceOptions {
  deviceId?: string;
  appVersion?: string;
  discoveryPort?: number;
  httpPort?: number;
  bindHost?: string;
  broadcastTargets?: string[];
  peerDiscoveryPorts?: number[];
  heartbeatIntervalMs?: number;
  peerTtlMs?: number;
  offerTtlMs?: number;
  getConfig?: () => LanShareConfig;
  onPeersChanged?: (peers: LanPeerRecord[]) => void;
  onIncomingOffer?: (offer: LanIncomingOffer) => void;
  onIncomingCancelled?: (transferId: string) => void;
  onTransferUpdate?: (transfer: LanOutgoingTransfer) => void;
  onImportPayload?: (
    offer: LanIncomingOffer,
    buffer: Buffer,
    importOptions: Record<string, any>,
  ) => Promise<any>;
}

export class LanShareService {
  readonly deviceId: string;
  readonly appVersion: string;
  private discoveryPort: number;
  private customHttpPort?: number;
  private bindHost: string;
  private customBroadcastTargets?: string[];
  private customPeerPorts?: number[];
  private heartbeatIntervalMs: number;
  private peerTtlMs: number;
  private offerTtlMs: number;
  private getConfig: () => LanShareConfig;
  private onPeersChanged?: (peers: LanPeerRecord[]) => void;
  private onIncomingOffer?: (offer: LanIncomingOffer) => void;
  private onIncomingCancelled?: (transferId: string) => void;
  private onTransferUpdate?: (transfer: LanOutgoingTransfer) => void;
  private onImportPayload?: LanShareServiceOptions["onImportPayload"];

  private httpServer: http.Server | null = null;
  private udpSocket: dgram.Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private httpPort = 0;
  private boundDiscoveryPort = 0;
  private discoveryError = "";
  private started = false;

  private peers = new Map<string, LanPeerRecord>();
  private incoming = new Map<string, IncomingInternal>();
  private outgoing = new Map<string, OutgoingInternal>();
  private trustedHosts = new Set<string>();

  constructor(options: LanShareServiceOptions = {}) {
    this.deviceId = String(options.deviceId || randomBytes(16).toString("hex"));
    this.appVersion = String(options.appVersion || "");
    this.discoveryPort = options.discoveryPort ?? DEFAULT_DISCOVERY_PORT;
    this.customHttpPort = options.httpPort;
    this.bindHost = options.bindHost || "0.0.0.0";
    this.customBroadcastTargets = options.broadcastTargets;
    this.customPeerPorts = options.peerDiscoveryPorts;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.peerTtlMs = options.peerTtlMs ?? PEER_TTL_MS;
    this.offerTtlMs = options.offerTtlMs ?? OFFER_TTL_MS;
    this.getConfig = options.getConfig || (() => ({ discoverable: true, nickname: "", loginAccount: "" }));
    this.onPeersChanged = options.onPeersChanged;
    this.onIncomingOffer = options.onIncomingOffer;
    this.onIncomingCancelled = options.onIncomingCancelled;
    this.onTransferUpdate = options.onTransferUpdate;
    this.onImportPayload = options.onImportPayload;
  }

  getListeningHttpPort() {
    return this.httpPort;
  }

  getListeningDiscoveryPort() {
    return this.boundDiscoveryPort;
  }

  setPeerDiscoveryPorts(ports: number[]) {
    this.customPeerPorts = ports;
  }

  getIdentity(): LanIdentity {
    const cfg = this.getConfig();
    return resolveLocalIdentity({
      deviceId: this.deviceId,
      nickname: cfg.nickname,
      loginAccount: cfg.loginAccount,
      appVersion: this.appVersion,
    });
  }

  getPeers(): LanPeerRecord[] {
    return [...this.peers.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, "zh-CN") || b.lastSeenAt - a.lastSeenAt,
    );
  }

  getIncomingOffers(): LanIncomingOffer[] {
    return [...this.incoming.values()].map((item) => item.offer);
  }

  getOutgoingTransfers(): LanOutgoingTransfer[] {
    return [...this.outgoing.values()].map((item) => ({ ...item.transfer }));
  }

  getState() {
    const cfg = this.getConfig();
    return {
      self: this.getIdentity(),
      discoverable: cfg.discoverable !== false,
      nickname: cfg.nickname || "",
      httpPort: this.httpPort,
      discoveryPort: this.boundDiscoveryPort,
      discoveryError: this.discoveryError,
      localAddresses: collectLocalLanIpv4s(),
      manualPeers: Array.isArray(cfg.manualPeers) ? cfg.manualPeers : [],
      peers: this.getPeers(),
      incoming: this.getIncomingOffers(),
      outgoing: this.getOutgoingTransfers(),
    };
  }

  private collectTrustedHosts(): Set<string> {
    const set = new Set<string>(this.trustedHosts);
    for (const raw of this.getConfig().manualPeers || []) {
      const parsed = parseManualPeerAddress(raw);
      if (parsed) set.add(parsed.host);
    }
    return set;
  }

  private isAllowedPeerIp(rawIp: string): boolean {
    return isAllowedLanPeerAddress(rawIp, { trustedHosts: this.collectTrustedHosts() });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.startHttpServer();
    await this.startUdpDiscovery();

    this.heartbeatTimer = setInterval(() => {
      this.evictStalePeers();
      if (this.getConfig().discoverable !== false) {
        this.broadcastPacket({ type: "announce" });
      }
      void this.probeConfiguredManualPeers();
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();

    if (this.getConfig().discoverable !== false) {
      this.broadcastPacket({ type: "announce" });
      this.broadcastPacket({ type: "discover" });
    }
    void this.probeConfiguredManualPeers();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    try {
      this.broadcastPacket({ type: "bye" });
    } catch {}

    for (const item of this.incoming.values()) {
      if (item.timer) clearTimeout(item.timer);
    }
    this.incoming.clear();

    for (const item of this.outgoing.values()) {
      if (item.timer) clearTimeout(item.timer);
      item.payloadBuffer = null;
    }
    this.outgoing.clear();
    this.peers.clear();

    await new Promise<void>((resolve) => {
      if (!this.udpSocket) return resolve();
      const sock = this.udpSocket;
      this.udpSocket = null;
      try {
        sock.close(() => resolve());
      } catch {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      if (!this.httpServer) return resolve();
      const srv = this.httpServer;
      this.httpServer = null;
      try {
        srv.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  /** 配置变更（如切换隐身或修改昵称）后立即向局域网同步 */
  syncVisibility() {
    if (!this.started) return;
    const cfg = this.getConfig();
    if (cfg.discoverable === false) {
      this.broadcastPacket({ type: "bye" });
    } else {
      this.broadcastPacket({ type: "announce" });
      this.broadcastPacket({ type: "discover" });
    }
  }

  refreshPeers(): LanPeerRecord[] {
    this.evictStalePeers();
    if (this.started) {
      if (this.getConfig().discoverable !== false) {
        this.broadcastPacket({ type: "announce" });
      }
      this.broadcastPacket({ type: "discover" });
      void this.probeConfiguredManualPeers();
    }
    return this.getPeers();
  }

  async refreshPeersAsync(): Promise<LanPeerRecord[]> {
    this.evictStalePeers();
    if (this.started) {
      if (this.getConfig().discoverable !== false) {
        this.broadcastPacket({ type: "announce" });
      }
      this.broadcastPacket({ type: "discover" });
      await this.probeConfiguredManualPeers();
    }
    return this.getPeers();
  }

  private upsertDiscoveredPeer(peer: LanPeerRecord) {
    const prev = this.peers.get(peer.deviceId);
    this.peers.set(peer.deviceId, peer);
    const changed = !prev
      || prev.displayName !== peer.displayName
      || prev.account !== peer.account
      || prev.ip !== peer.ip
      || prev.httpPort !== peer.httpPort;
    if (changed) {
      this.onPeersChanged?.(this.getPeers());
    }
  }

  private sendUnicastPacket(type: "announce" | "discover", targetIp: string, targetPort: number) {
    if (!this.udpSocket || !targetIp || !targetPort) return;
    const identity = this.getIdentity();
    const packet = Buffer.from(JSON.stringify({
      protocol: LAN_SHARE_PROTOCOL,
      version: LAN_SHARE_PROTOCOL_VERSION,
      type,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      account: identity.account,
      host: identity.host,
      platform: identity.platform,
      appVersion: identity.appVersion,
      httpPort: this.httpPort,
    }), "utf8");
    try {
      this.udpSocket.send(packet, targetPort, targetIp, () => {});
    } catch {}
  }

  /** 主动探测指定 IP（支持跨 /24 子网直连 HTTP /lan-share/info + 单播 UDP discover） */
  async probeManualTarget(rawTarget: string): Promise<{ ok: boolean; peer?: LanPeerRecord; normalized?: string; error?: string }> {
    const parsed = parseManualPeerAddress(rawTarget);
    if (!parsed) {
      return { ok: false, error: "请输入合法的局域网 IP 或 地址:端口（例如 172.168.138.154）" };
    }
    this.trustedHosts.add(parsed.host);

    // 1. 尝试单播 UDP discover（若同主机名/同端口开启）
    const discoveryPorts = (this.customPeerPorts && this.customPeerPorts.length)
      ? this.customPeerPorts
      : [this.boundDiscoveryPort || this.discoveryPort];
    for (const port of discoveryPorts) {
      if (port > 0) this.sendUnicastPacket("discover", parsed.host, port);
    }

    // 2. 直接通过 HTTP 探测 /lan-share/info（跨子网无广播必达路径）
    const httpPorts = parsed.port ? [parsed.port] : [DEFAULT_HTTP_PORT];
    let lastErr = "";
    for (const port of httpPorts) {
      try {
        const resp = await getJson(`http://${parsed.host}:${port}/lan-share/info`, 3000);
        if (resp.status === 200 && resp.data?.ok && resp.data?.protocol === LAN_SHARE_PROTOCOL) {
          const peerId = String(resp.data?.deviceId || "").trim();
          if (!peerId || peerId === this.deviceId) {
            return { ok: false, error: "不能连接当前本机设备" };
          }
          if (resp.data?.discoverable === false) {
            return { ok: false, error: "对方已开启隐身模式，请对方在局域网分享中打开「可被发现」" };
          }
          const resolvedPort = Number(resp.data?.httpPort || port);
          const peer: LanPeerRecord = {
            deviceId: peerId,
            displayName: String(resp.data?.displayName || resp.data?.account || resp.data?.host || parsed.host).slice(0, 64),
            account: String(resp.data?.account || "").slice(0, 64),
            host: String(resp.data?.host || "").slice(0, 64),
            platform: String(resp.data?.platform || ""),
            appVersion: String(resp.data?.appVersion || ""),
            ip: parsed.host,
            httpPort: resolvedPort > 0 ? resolvedPort : port,
            lastSeenAt: Date.now(),
          };
          this.upsertDiscoveredPeer(peer);
          return { ok: true, peer, normalized: parsed.normalized };
        }
        lastErr = resp.data?.error || `HTTP ${resp.status}`;
      } catch (err: any) {
        lastErr = String(err?.message || err);
      }
    }

    // 等待短暂窗口看 UDP 单播是否刚好把对端注册进来（比如对方随机端口但开了 UDP 41234）
    await new Promise((r) => setTimeout(r, 250));
    const udpMatched = [...this.peers.values()].find((p) => normalizeIpAddress(p.ip) === parsed.host);
    if (udpMatched) {
      return { ok: true, peer: udpMatched, normalized: parsed.normalized };
    }

    return {
      ok: false,
      error: `无法连接到 ${parsed.normalized}${lastErr ? `（${lastErr}）` : ""}。请确认对方已升级并打开 DYWorker、关闭隐身，且内网允许访问端口 ${httpPorts[0]}`,
    };
  }

  private async probeConfiguredManualPeers() {
    const list = this.getConfig().manualPeers || [];
    if (!list.length) return;
    await Promise.all(list.map((target) => this.probeManualTarget(target).catch(() => null)));
  }

  private startHttpServer(): Promise<void> {
    const tryListen = (port: number) => new Promise<http.Server>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handleHttpRequest(req, res);
      });
      server.once("error", reject);
      server.listen(port, this.bindHost, () => {
        server.removeAllListeners("error");
        server.on("error", () => {});
        resolve(server);
      });
    });

    const preferredPort = this.customHttpPort !== undefined
      ? this.customHttpPort
      : (this.discoveryPort === 0 ? 0 : DEFAULT_HTTP_PORT);

    return tryListen(preferredPort)
      .catch((err) => {
        if (preferredPort > 0) return tryListen(0);
        throw err;
      })
      .then((server) => {
        const addr = server.address();
        this.httpPort = typeof addr === "object" && addr ? addr.port : 0;
        this.httpServer = server;
      });
  }

  private startUdpDiscovery(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
        socket.on("error", (err: any) => {
          this.discoveryError = String(err?.message || err);
        });
        socket.on("message", (msg, rinfo) => {
          this.handleUdpMessage(msg, rinfo);
        });
        socket.bind(this.discoveryPort, this.bindHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0", () => {
          try {
            socket.setBroadcast(true);
          } catch {}
          const addr = socket.address();
          this.boundDiscoveryPort = typeof addr === "object" && addr ? addr.port : this.discoveryPort;
          this.udpSocket = socket;
          this.discoveryError = "";
          resolve();
        });
      } catch (err: any) {
        this.discoveryError = String(err?.message || err);
        resolve();
      }
    });
  }

  private broadcastPacket(payload: { type: "announce" | "discover" | "bye" }) {
    if (!this.udpSocket) return;
    const identity = this.getIdentity();
    const packet = Buffer.from(JSON.stringify({
      protocol: LAN_SHARE_PROTOCOL,
      version: LAN_SHARE_PROTOCOL_VERSION,
      type: payload.type,
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      account: identity.account,
      host: identity.host,
      platform: identity.platform,
      appVersion: identity.appVersion,
      httpPort: this.httpPort,
    }), "utf8");

    const hosts = this.customBroadcastTargets || collectLanBroadcastTargets();
    const ports = (this.customPeerPorts && this.customPeerPorts.length)
      ? this.customPeerPorts
      : [this.boundDiscoveryPort || this.discoveryPort];

    for (const targetHost of hosts) {
      for (const port of ports) {
        if (!port) continue;
        try {
          this.udpSocket.send(packet, port, targetHost, () => {});
        } catch {
          // 忽略不可达网卡的广播发送失败
        }
      }
    }
  }

  private sendUnicastAnnounce(targetIp: string, targetPort: number) {
    if (!this.udpSocket || !targetIp || !targetPort) return;
    const identity = this.getIdentity();
    const packet = Buffer.from(JSON.stringify({
      protocol: LAN_SHARE_PROTOCOL,
      version: LAN_SHARE_PROTOCOL_VERSION,
      type: "announce",
      deviceId: identity.deviceId,
      displayName: identity.displayName,
      account: identity.account,
      host: identity.host,
      platform: identity.platform,
      appVersion: identity.appVersion,
      httpPort: this.httpPort,
    }), "utf8");
    try {
      this.udpSocket.send(packet, targetPort, targetIp, () => {});
    } catch {}
  }

  private handleUdpMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (!this.isAllowedPeerIp(rinfo.address)) return;
    let parsed: any;
    try {
      parsed = JSON.parse(msg.toString("utf8"));
    } catch {
      return;
    }
    if (parsed?.protocol !== LAN_SHARE_PROTOCOL || Number(parsed?.version) !== LAN_SHARE_PROTOCOL_VERSION) {
      return;
    }
    const senderDeviceId = String(parsed?.deviceId || "").trim();
    if (!senderDeviceId || senderDeviceId === this.deviceId) return;

    const msgType = String(parsed?.type || "");
    if (msgType === "bye") {
      if (this.peers.delete(senderDeviceId)) {
        this.onPeersChanged?.(this.getPeers());
      }
      return;
    }

    if (msgType === "discover") {
      if (this.getConfig().discoverable !== false) {
        this.sendUnicastAnnounce(rinfo.address, rinfo.port);
      }
      return;
    }

    if (msgType === "announce") {
      const httpPort = Number(parsed?.httpPort || 0);
      if (!Number.isInteger(httpPort) || httpPort <= 0 || httpPort > 65535) return;
      const ip = normalizeIpAddress(rinfo.address);
      const nextPeer: LanPeerRecord = {
        deviceId: senderDeviceId,
        displayName: String(parsed?.displayName || parsed?.account || parsed?.host || "DYWorker 用户").slice(0, 64),
        account: String(parsed?.account || "").slice(0, 64),
        host: String(parsed?.host || "").slice(0, 64),
        platform: String(parsed?.platform || ""),
        appVersion: String(parsed?.appVersion || ""),
        ip,
        httpPort,
        lastSeenAt: Date.now(),
      };
      this.upsertDiscoveredPeer(nextPeer);
    }
  }

  private evictStalePeers() {
    const now = Date.now();
    let removed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeenAt > this.peerTtlMs) {
        this.peers.delete(id);
        removed = true;
      }
    }
    if (removed) {
      this.onPeersChanged?.(this.getPeers());
    }
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const remoteIp = normalizeIpAddress(req.socket.remoteAddress);
    if (!this.isAllowedPeerIp(remoteIp)) {
      writeJsonResponse(res, 403, { ok: false, error: "仅允许局域网设备访问" });
      return;
    }

    const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${this.httpPort || 80}`);

    try {
      if (req.method === "GET" && reqUrl.pathname === "/lan-share/info") {
        const cfg = this.getConfig();
        const identity = this.getIdentity();
        writeJsonResponse(res, 200, {
          ok: true,
          protocol: LAN_SHARE_PROTOCOL,
          version: LAN_SHARE_PROTOCOL_VERSION,
          ...identity,
          httpPort: this.httpPort,
          discoverable: cfg.discoverable !== false,
        });
        return;
      }

      if (req.method === "POST" && reqUrl.pathname === "/lan-share/offer") {
        if (this.getConfig().discoverable === false) {
          writeJsonResponse(res, 403, { ok: false, error: "对方当前已开启隐身，暂不接收局域网分享" });
          return;
        }
        const body = await readRequestJson(req);
        const kind = body?.kind === "project" ? "project" : body?.kind === "plugin" ? "plugin" : body?.kind === "session" ? "session" : "";
        const transferId = String(body?.transferId || "").trim();
        const title = String(body?.title || "").trim();
        const fileName = String(body?.fileName || "").trim();
        const sha256 = String(body?.sha256 || "").trim();
        const downloadToken = String(body?.downloadToken || "").trim();
        const sizeBytes = Number(body?.sizeBytes || 0);
        const senderPort = Number(body?.sender?.httpPort || 0);
        const senderId = String(body?.sender?.deviceId || "").trim();

        if (!kind || !transferId || !title || !sha256 || !downloadToken || !senderId || senderPort <= 0) {
          writeJsonResponse(res, 400, { ok: false, error: "分享请求参数不完整" });
          return;
        }
        const maxSize = kind === "plugin" ? MAX_PLUGIN_TRANSFER_BYTES : MAX_SESSION_TRANSFER_BYTES;
        if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxSize) {
          writeJsonResponse(res, 413, { ok: false, error: "分享文件体积超出允许上限" });
          return;
        }

        const now = Date.now();
        const offer: LanIncomingOffer = {
          transferId,
          kind,
          title: title.slice(0, 120),
          fileName: fileName.slice(0, 160) || title.slice(0, 120),
          sizeBytes,
          sha256,
          downloadToken,
          senderIp: remoteIp,
          sender: {
            deviceId: senderId,
            displayName: String(body?.sender?.displayName || body?.sender?.account || body?.sender?.host || "同事").slice(0, 64),
            account: String(body?.sender?.account || "").slice(0, 64),
            host: String(body?.sender?.host || "").slice(0, 64),
            platform: String(body?.sender?.platform || ""),
            httpPort: senderPort,
          },
          meta: body?.meta && typeof body.meta === "object" ? body.meta : {},
          receivedAt: now,
          expiresAt: now + this.offerTtlMs,
        };

        const prev = this.incoming.get(transferId);
        if (prev?.timer) clearTimeout(prev.timer);
        const timer = setTimeout(() => {
          if (this.incoming.delete(transferId)) {
            this.onIncomingCancelled?.(transferId);
          }
        }, this.offerTtlMs);
        timer.unref?.();
        this.incoming.set(transferId, { offer, timer });

        this.onIncomingOffer?.(offer);
        writeJsonResponse(res, 200, { ok: true, status: "pending" });
        return;
      }

      if (req.method === "POST" && reqUrl.pathname === "/lan-share/decision") {
        const body = await readRequestJson(req);
        const transferId = String(body?.transferId || "").trim();
        const token = String(body?.token || "").trim();
        const entry = this.outgoing.get(transferId);
        if (!entry || !safeTimingEqual(entry.downloadToken, token)) {
          writeJsonResponse(res, 403, { ok: false, error: "无效的分享令牌" });
          return;
        }
        if (body?.accepted) {
          this.updateOutgoingStatus(entry, "transferring");
        } else {
          this.cleanupOutgoingPayload(entry);
          this.updateOutgoingStatus(entry, "rejected", String(body?.reason || "对方已拒绝接收"));
        }
        writeJsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && reqUrl.pathname === "/lan-share/download") {
        const transferId = String(reqUrl.searchParams.get("id") || "").trim();
        const token = String(reqUrl.searchParams.get("token") || "").trim();
        const entry = this.outgoing.get(transferId);
        if (!entry || !entry.payloadBuffer) {
          writeJsonResponse(res, 404, { ok: false, error: "分享内容已失效或已完成" });
          return;
        }
        if (!safeTimingEqual(entry.downloadToken, token)) {
          writeJsonResponse(res, 403, { ok: false, error: "无效的下载令牌" });
          return;
        }
        this.updateOutgoingStatus(entry, "transferring");
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": entry.payloadBuffer.length,
          "X-DYWorker-Sha256": entry.sha256,
        });
        res.end(entry.payloadBuffer);
        return;
      }

      if (req.method === "POST" && reqUrl.pathname === "/lan-share/complete") {
        const body = await readRequestJson(req);
        const transferId = String(body?.transferId || "").trim();
        const token = String(body?.token || "").trim();
        const entry = this.outgoing.get(transferId);
        if (!entry || !safeTimingEqual(entry.downloadToken, token)) {
          writeJsonResponse(res, 403, { ok: false, error: "无效的分享令牌" });
          return;
        }
        this.cleanupOutgoingPayload(entry);
        if (body?.ok !== false) {
          this.updateOutgoingStatus(entry, "completed");
        } else {
          this.updateOutgoingStatus(entry, "failed", String(body?.error || "对方导入失败"));
        }
        writeJsonResponse(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && reqUrl.pathname === "/lan-share/cancel") {
        const body = await readRequestJson(req);
        const transferId = String(body?.transferId || "").trim();
        const token = String(body?.token || "").trim();
        const item = this.incoming.get(transferId);
        if (item && safeTimingEqual(item.offer.downloadToken, token)) {
          if (item.timer) clearTimeout(item.timer);
          this.incoming.delete(transferId);
          this.onIncomingCancelled?.(transferId);
        }
        writeJsonResponse(res, 200, { ok: true });
        return;
      }

      writeJsonResponse(res, 404, { ok: false, error: "Not Found" });
    } catch (error: any) {
      writeJsonResponse(res, 400, { ok: false, error: String(error?.message || error) });
    }
  }

  private cleanupOutgoingPayload(entry: OutgoingInternal) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.payloadBuffer = null;
  }

  private updateOutgoingStatus(entry: OutgoingInternal, status: LanOutgoingStatus, error?: string) {
    entry.transfer.status = status;
    entry.transfer.updatedAt = Date.now();
    if (error) entry.transfer.error = error;
    else delete entry.transfer.error;
    this.onTransferUpdate?.({ ...entry.transfer });
  }

  /** 发送分享请求（先仅推元信息，等对方同意再拉取文件） */
  async sendOffer(options: {
    peerId: string;
    kind: LanShareKind;
    title: string;
    fileName: string;
    meta?: Record<string, any>;
    payloadBuffer: Buffer;
  }) {
    const peer = this.peers.get(options.peerId);
    if (!peer) {
      return { ok: false, error: "该用户已离线或未在局域网列表中，请刷新后重试" };
    }
    if (!this.isAllowedPeerIp(peer.ip)) {
      return { ok: false, error: "目标地址不在局域网可信范围内" };
    }

    const maxSize = options.kind === "plugin" ? MAX_PLUGIN_TRANSFER_BYTES : MAX_SESSION_TRANSFER_BYTES;
    if (!Buffer.isBuffer(options.payloadBuffer) || options.payloadBuffer.length === 0) {
      return { ok: false, error: "分享内容为空" };
    }
    if (options.payloadBuffer.length > maxSize) {
      return { ok: false, error: "分享内容超过局域网传输大小限制" };
    }

    const transferId = randomUUID();
    const downloadToken = randomBytes(24).toString("hex");
    const sha256 = createHash("sha256").update(options.payloadBuffer).digest("hex");
    const now = Date.now();
    const identity = this.getIdentity();

    const transfer: LanOutgoingTransfer = {
      transferId,
      peerId: peer.deviceId,
      peerName: peer.displayName,
      kind: options.kind,
      title: options.title,
      fileName: options.fileName,
      sizeBytes: options.payloadBuffer.length,
      status: "waiting",
      createdAt: now,
      updatedAt: now,
    };

    const internal: OutgoingInternal = {
      transfer,
      peerIp: peer.ip,
      peerHttpPort: peer.httpPort,
      downloadToken,
      sha256,
      payloadBuffer: options.payloadBuffer,
      timer: null,
    };

    internal.timer = setTimeout(() => {
      if (internal.transfer.status === "waiting") {
        this.cleanupOutgoingPayload(internal);
        this.updateOutgoingStatus(internal, "failed", "对方超时未响应，传输已自动关闭");
      }
    }, this.offerTtlMs);
    internal.timer.unref?.();
    this.outgoing.set(transferId, internal);

    try {
      const resp = await postJson(`http://${peer.ip}:${peer.httpPort}/lan-share/offer`, {
        transferId,
        kind: options.kind,
        title: options.title,
        fileName: options.fileName,
        sizeBytes: options.payloadBuffer.length,
        sha256,
        downloadToken,
        sender: {
          deviceId: identity.deviceId,
          displayName: identity.displayName,
          account: identity.account,
          host: identity.host,
          platform: identity.platform,
          httpPort: this.httpPort,
        },
        meta: options.meta || {},
      });

      if (resp.status >= 400 || resp.data?.ok === false) {
        this.cleanupOutgoingPayload(internal);
        const errMsg = String(resp.data?.error || `对方拒绝了分享请求（HTTP ${resp.status}）`);
        this.updateOutgoingStatus(internal, "failed", errMsg);
        return { ok: false, transferId, error: errMsg };
      }

      this.onTransferUpdate?.({ ...transfer });
      return { ok: true, transferId, transfer: { ...transfer } };
    } catch (error: any) {
      this.cleanupOutgoingPayload(internal);
      const errMsg = `无法连接对方设备：${String(error?.message || error)}`;
      this.updateOutgoingStatus(internal, "failed", errMsg);
      return { ok: false, transferId, error: errMsg };
    }
  }

  async cancelOutgoing(transferId: string) {
    const entry = this.outgoing.get(transferId);
    if (!entry) return { ok: false, error: "找不到该分享任务" };
    const token = entry.downloadToken;
    const targetUrl = `http://${entry.peerIp}:${entry.peerHttpPort}/lan-share/cancel`;
    this.cleanupOutgoingPayload(entry);
    this.updateOutgoingStatus(entry, "cancelled");
    try {
      await postJson(targetUrl, { transferId, token }, 3000);
    } catch {}
    return { ok: true };
  }

  /** 接收方处理入站分享请求：拒绝直接回告；同意则拉取、SHA-256 校验并交由业务导入（导入或传输临时失败时保留请求以便重试） */
  async respondIncoming(
    transferId: string,
    options: { accepted: boolean; importOptions?: Record<string, any> },
  ) {
    const item = this.incoming.get(transferId);
    if (!item) {
      return { ok: false, error: "该分享请求已过期或被发送方取消" };
    }
    if (item.processing) {
      return { ok: false, error: "正在传输并导入中，请稍候" };
    }
    const { offer } = item;

    const decisionUrl = `http://${offer.senderIp}:${offer.sender.httpPort}/lan-share/decision`;
    const completeUrl = `http://${offer.senderIp}:${offer.sender.httpPort}/lan-share/complete`;

    if (!options.accepted) {
      if (item.timer) clearTimeout(item.timer);
      item.timer = null;
      this.incoming.delete(transferId);
      try {
        await postJson(decisionUrl, {
          transferId: offer.transferId,
          token: offer.downloadToken,
          accepted: false,
          reason: "对方已拒绝接收",
        }, 5000);
      } catch {}
      return { ok: true, accepted: false };
    }

    item.processing = true;
    if (item.timer) {
      clearTimeout(item.timer);
      item.timer = null;
    }

    const restoreIncomingForRetry = () => {
      if (this.incoming.get(transferId) !== item) return;
      item.processing = false;
      const remainingMs = Math.max(30_000, offer.expiresAt - Date.now());
      const timer = setTimeout(() => {
        if (this.incoming.delete(transferId)) {
          this.onIncomingCancelled?.(transferId);
        }
      }, remainingMs);
      timer.unref?.();
      item.timer = timer;
    };

    try {
      await postJson(decisionUrl, {
        transferId: offer.transferId,
        token: offer.downloadToken,
        accepted: true,
      }, 5000);
    } catch {}

    const maxBytes = offer.kind === "plugin" ? MAX_PLUGIN_TRANSFER_BYTES : MAX_SESSION_TRANSFER_BYTES;
    let downloaded: Buffer;
    try {
      const dlUrl = `http://${offer.senderIp}:${offer.sender.httpPort}/lan-share/download`
        + `?id=${encodeURIComponent(offer.transferId)}&token=${encodeURIComponent(offer.downloadToken)}`;
      downloaded = await downloadBinary(dlUrl, maxBytes);
    } catch (error: any) {
      const msg = String(error?.message || error);
      // 发送方载荷已失效/令牌无效（HTTP 404/403）说明发送方已超时销毁或取消，清理本端并给出明确引导
      if (/\bHTTP\s*(?:403|404)\b/.test(msg)) {
        this.incoming.delete(transferId);
        this.onIncomingCancelled?.(transferId);
        return { ok: false, accepted: true, error: "发送方已取消或该分享已失效，请让对方重新发送" };
      }
      restoreIncomingForRetry();
      return { ok: false, accepted: true, error: msg };
    }

    const actualSha = createHash("sha256").update(downloaded).digest("hex");
    if (!safeTimingEqual(actualSha, offer.sha256)) {
      this.incoming.delete(transferId);
      const errMsg = "文件完整性校验失败（SHA-256 不匹配），已取消导入";
      try {
        await postJson(completeUrl, { transferId: offer.transferId, token: offer.downloadToken, ok: false, error: errMsg }, 5000);
      } catch {}
      return { ok: false, accepted: true, error: errMsg };
    }

    try {
      const importResult = this.onImportPayload
        ? await this.onImportPayload(offer, downloaded, options.importOptions || {})
        : { ok: true, buffer: downloaded };
      const ok = importResult?.ok !== false;
      if (ok) {
        this.incoming.delete(transferId);
        try {
          await postJson(completeUrl, {
            transferId: offer.transferId,
            token: offer.downloadToken,
            ok: true,
          }, 5000);
        } catch {}
        return {
          ok: true,
          accepted: true,
          kind: offer.kind,
          offer,
          buffer: this.onImportPayload ? undefined : downloaded,
          importResult,
        };
      }
      restoreIncomingForRetry();
      return {
        ok: false,
        accepted: true,
        kind: offer.kind,
        offer,
        buffer: this.onImportPayload ? undefined : downloaded,
        importResult,
        error: importResult?.error || "导入失败",
      };
    } catch (error: any) {
      const msg = String(error?.message || error);
      restoreIncomingForRetry();
      return { ok: false, accepted: true, error: msg };
    }
  }
}
