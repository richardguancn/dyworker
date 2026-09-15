import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// 会话存档的按会话拆分存储：sessions/<id>.json 每会话一个文件 +
// sessions/index.json 只存顺序（文件名由 id 确定性推导）。
//
// 拆分前是单个 sessions.json：流式输出期间以秒级频率整档重写（几十 MB
// 档位在 Linux 上实测 194MB/s 磁盘写入），每次保存的 stringify 与 IPC
// 结构化克隆还把进程拖入 OOM。拆分后渲染端只把「变化的会话」作为增量
// 发来（applyDelta），单次落盘只有毫秒级的小文件写入。
//
// 兼容：首次访问时若发现旧的单文件 sessions.json 则迁移为拆分存储，旧
// 文件改名为 sessions.json.migrated 留作备份。旧渲染端仍发整档数组时
// 走 saveAll，内部按内容指纹只重写变化的会话文件。
//
// 所有公开方法都先确保迁移完成再操作（无窗口的唤醒续跑会在 initial-state
// 之前触发落盘，绝不能带着空顺序覆盖 index），内部经同一条 promise 链
// 串行执行，避免读写与迁移交错。

const INDEX_NAME = "index.json";

// 文件名 = 清洗后的 id + 原始 id 的短哈希：不同 id 清洗后同名也能区分
function encodeSessionId(id) {
  const raw = String(id || "");
  const base = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "session";
  const hash = crypto.createHash("sha1").update(raw).digest("hex").slice(0, 8);
  return `${base}-${hash}.json`;
}

function contentFingerprint(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value, null, 2)).digest("hex");
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function createSessionArchive({ dir, legacyFile }) {
  let entries = []; // 有序 [{ id, file }]
  let byId = new Map(); // id -> 已解析会话对象（主进程内存镜像）
  let fingerprints = new Map(); // id -> 内容指纹（saveAll 差异化写入用）
  let migrated = false;
  let chain = Promise.resolve();

  const enqueue = (job) => {
    const run = chain.catch(() => {}).then(job);
    chain = run.catch(() => {});
    return run;
  };

  const indexPath = () => path.join(dir, INDEX_NAME);

  const writeIndex = async () => {
    await writeAtomic(indexPath(), JSON.stringify({ version: 1, order: entries.map((entry) => entry.id) }, null, 2));
  };

  const writeSessionFile = async (session) => {
    const file = path.join(dir, encodeSessionId(session.id));
    await writeAtomic(file, JSON.stringify(session, null, 2));
    return file;
  };

  // 内存镜像单会话读取：命中缓存直接返回，否则读对应文件
  const readSession = async (key) => {
    if (byId.has(key)) return byId.get(key);
    const entry = entries.find((item) => item.id === key);
    if (!entry) return null;
    const session = await readJsonFile(path.join(dir, entry.file), null);
    if (session?.id) {
      byId.set(String(session.id), session);
      fingerprints.set(String(session.id), contentFingerprint(session));
      return session;
    }
    return null;
  };

  // index 缺失时从目录恢复（迁移中途崩溃等）：顺序按 updatedAt 近者在前
  const recoverFromDirectory = async () => {
    let names = [];
    try {
      names = (await fs.readdir(dir)).filter((name) => name.endsWith(".json") && name !== INDEX_NAME);
    } catch {
      return false;
    }
    const loaded = [];
    for (const name of names) {
      const session = await readJsonFile(path.join(dir, name), null);
      if (session?.id) loaded.push(session);
    }
    loaded.sort((a, b) => String(b?.updatedAt || "").localeCompare(String(a?.updatedAt || "")));
    entries = loaded.map((session) => ({ id: String(session.id), file: encodeSessionId(session.id) }));
    for (const session of loaded) {
      byId.set(String(session.id), session);
      fingerprints.set(String(session.id), contentFingerprint(session));
    }
    await writeIndex().catch(() => {});
    return loaded.length > 0;
  };

  const ensureMigrated = async () => {
    if (migrated) return;
    const index = await readJsonFile(indexPath(), null);
    if (index && Array.isArray(index.order)) {
      entries = index.order.map((id) => ({ id: String(id), file: encodeSessionId(id) }));
      migrated = true;
      return;
    }
    const legacy = await readJsonFile(legacyFile, null);
    if (Array.isArray(legacy) && legacy.length) {
      // 迁移旧单文件存档：按会话拆分写入后，旧文件改名留作备份
      const sessions = legacy.filter((item) => item?.id);
      for (const session of sessions) {
        await writeSessionFile(session).catch(() => {});
      }
      entries = sessions.map((session) => ({ id: String(session.id), file: encodeSessionId(session.id) }));
      for (const session of sessions) {
        byId.set(String(session.id), session);
        fingerprints.set(String(session.id), contentFingerprint(session));
      }
      await writeIndex();
      await fs.rename(legacyFile, `${legacyFile}.migrated`).catch(() => {});
      migrated = true;
      return;
    }
    if (await recoverFromDirectory()) {
      migrated = true;
      return;
    }
    migrated = true; // 全新安装：空存档
  };

  // order 是权威视图：删除不在其中的会话文件，重建 index 与内存镜像
  const persistOrder = async (orderedIds) => {
    const expected = new Set(orderedIds.map((id) => encodeSessionId(id)));
    expected.add(INDEX_NAME);
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      // 目录尚未创建：写入 index 时会自动建
    }
    for (const name of names) {
      if (!name.endsWith(".json") || expected.has(name)) continue;
      await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
    }
    entries = orderedIds.map((id) => ({ id, file: encodeSessionId(id) }));
    for (const id of [...byId.keys()]) {
      if (!orderedIds.includes(id)) {
        byId.delete(id);
        fingerprints.delete(id);
      }
    }
    await writeIndex();
  };

  const withArchive = (job) => enqueue(async () => {
    await ensureMigrated();
    return job();
  });

  return {
    // 全量装载（主进程各只读消费方：历史检索、会话工具、渠道工作区推导等）
    loadAll() {
      return withArchive(async () => {
        const missing = entries.filter((entry) => !byId.has(entry.id));
        await Promise.all(missing.map(async (entry) => {
          const session = await readJsonFile(path.join(dir, entry.file), null);
          if (session?.id) {
            byId.set(String(session.id), session);
            fingerprints.set(String(session.id), contentFingerprint(session));
          }
        }));
        const loaded = entries.map((entry) => byId.get(entry.id)).filter(Boolean);
        // index 里有但文件缺失的会话剔除出顺序，避免每次装载都重复读失败
        if (loaded.length !== entries.length) {
          entries = loaded.map((session) => ({ id: String(session.id), file: encodeSessionId(session.id) }));
        }
        return loaded;
      });
    },

    // 单会话读取（窗口关闭期间的续跑转录等只需一个会话的场景）
    get(sessionId) {
      const key = String(sessionId || "");
      return withArchive(() => readSession(key));
    },

    // 旧渲染端整档快照：按内容指纹只重写变化的会话文件
    async saveAll(sessions) {
      return withArchive(async () => {
        const incoming = (Array.isArray(sessions) ? sessions : []).filter((item) => item?.id);
        const nextFingerprints = new Map();
        for (const session of incoming) {
          const key = String(session.id);
          const fingerprint = contentFingerprint(session);
          nextFingerprints.set(key, fingerprint);
          if (fingerprints.get(key) === fingerprint && byId.has(key)) continue;
          await writeSessionFile(session);
          byId.set(key, session);
          fingerprints.set(key, fingerprint);
        }
        await persistOrder(incoming.map((session) => String(session.id)));
        fingerprints = nextFingerprints;
      });
    },

    // 渲染端增量：changed 原样写入、removed 删除、order 作为权威顺序
    async applyDelta({ changed = [], removed = [], order = [] } = {}) {
      return withArchive(async () => {
        for (const session of changed) {
          if (!session?.id) continue;
          const key = String(session.id);
          await writeSessionFile(session);
          byId.set(key, session);
          fingerprints.set(key, contentFingerprint(session));
        }
        for (const id of removed) {
          const key = String(id || "");
          if (!key) continue;
          await fs.rm(path.join(dir, encodeSessionId(key)), { force: true }).catch(() => {});
          byId.delete(key);
          fingerprints.delete(key);
        }
        await persistOrder(order.map((id) => String(id)));
      });
    },

    // 窗口关闭期间计划任务的转录落盘：已存在则跳过（原 persistSessionRecord 语义）
    async upsert(session) {
      return withArchive(async () => {
        if (!session?.id) return;
        const key = String(session.id);
        if (entries.some((entry) => entry.id === key)) return;
        await writeSessionFile(session);
        byId.set(key, session);
        fingerprints.set(key, contentFingerprint(session));
        entries = [{ id: key, file: encodeSessionId(key) }, ...entries];
        await writeIndex();
      });
    },

    // 窗口关闭期间唤醒续跑的转录追加（按 role:content 去重，原 persistSessionAppend 语义）
    async appendMessages(sessionId, messages) {
      return withArchive(async () => {
        const key = String(sessionId || "");
        if (!key || !Array.isArray(messages)) return;
        const session = await readSession(key);
        if (!session) return;
        const known = new Set((session.messages || []).map((message) => `${message?.role}:${message?.content}`));
        for (const message of messages) {
          if (!known.has(`${message?.role}:${message?.content}`)) session.messages.push(message);
        }
        session.updatedAt = new Date().toISOString();
        await writeSessionFile(session);
        fingerprints.set(key, contentFingerprint(session));
      });
    },
  };
}
