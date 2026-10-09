import { promises as fs } from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
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

// 退役的会话文件不删除，移入 sessions/.removed/<时间戳>/ 保留
const REMOVED_DIR = ".removed";
const REMOVED_KEEP = 20;

async function retireSessionFile(dir, name, stamp) {
  try {
    const target = path.join(dir, REMOVED_DIR, stamp || new Date().toISOString().replace(/[:.]/g, "-"));
    await fs.mkdir(target, { recursive: true });
    await fs.rename(path.join(dir, name), path.join(target, name));
    return true;
  } catch {
    return false;
  }
}

// 把当前 index.json 快照进最近一批备份目录（回滚时与文件一起恢复）
async function backupIndexSnapshot(dir) {
  try {
    const root = path.join(dir, REMOVED_DIR);
    const stamps = (await fs.readdir(root)).sort();
    const latest = stamps[stamps.length - 1];
    if (!latest) return;
    await fs.copyFile(path.join(dir, INDEX_NAME), path.join(root, latest, INDEX_NAME)).catch(() => {});
  } catch {
    // 没有备份目录或 index 不存在：跳过
  }
}

// 备份目录只留最近 REMOVED_KEEP 批，避免无限增长
async function pruneRemovedBackups(dir) {
  try {
    const root = path.join(dir, REMOVED_DIR);
    const stamps = (await fs.readdir(root)).sort();
    for (const stale of stamps.slice(0, Math.max(0, stamps.length - REMOVED_KEEP))) {
      await fs.rm(path.join(root, stale), { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    // 目录不存在：无需清理
  }
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
  // 渲染端最后选中的会话 id：随 index.json 持久化，重启后恢复选中（recoverFromDirectory 无法恢复时保持空串）
  let activeId = "";
  let chain = Promise.resolve();

  const enqueue = (job) => {
    const run = chain.catch(() => {}).then(job);
    chain = run.catch(() => {});
    return run;
  };

  const indexPath = () => path.join(dir, INDEX_NAME);

  const writeIndex = async () => {
    await writeAtomic(indexPath(), JSON.stringify({ version: 1, order: entries.map((entry) => entry.id), activeId: activeId || undefined }, null, 2));
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
      activeId = String(index.activeId || ""); // 旧版 index 无此字段，保持空串
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

  // order 是权威视图：重建 index 与内存镜像。
  // 但"渲染端少报即删"曾造成不可逆的历史丢失（某次拿到空的初始状态后保存，磁盘上的
  // 会话会被整批删掉）。现在改为把不在 order 里的文件**移入 sessions/.removed/<时间戳>/**
  // 而不是 fs.rm，任何一次误删都能从备份取回；同时留下告警便于定位。
  const persistOrder = async (orderedIds, explicitRemovals = null) => {
    const expected = new Set(orderedIds.map((id) => encodeSessionId(id)));
    expected.add(INDEX_NAME);
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      // 目录尚未创建：写入 index 时会自动建
    }
    // 安全闸：渲染端"没显式要求删除"却让存档大幅缩水，是异常状态（空状态覆盖、
    // handler 抛错导致初始化失败等）的典型特征。宁可拒绝这次保存，也不能让历史消失。
    const onDisk = names.filter((name) => name.endsWith(".json") && name !== INDEX_NAME);
    const candidates = onDisk.filter((name) => !expected.has(name) && !(explicitRemovals && explicitRemovals.has(name)));
    const allowance = Math.max(5, Math.floor(onDisk.length * 0.2));
    if (!explicitRemovals && candidates.length > allowance) {
      console.warn(`[session-archive] 拒绝一次异常缩水：磁盘 ${onDisk.length} 个会话，本次保存只保留 ${orderedIds.length} 个（将移出 ${candidates.length} > 允许 ${allowance}）。已保留原存档，请检查渲染端初始状态。`);
      return { blocked: true, total: onDisk.length, kept: orderedIds.length, wouldRetire: candidates.length };
    }
    const retired = [];
    // 同一次 saveAll 产生的退役文件放同一批，便于整体回滚
    const batchStamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const name of names) {
      if (!name.endsWith(".json") || expected.has(name)) continue;
      if (await retireSessionFile(dir, name, batchStamp)) retired.push(name);
    }
    if (retired.length) {
      // 备份目录要能自证回滚：连同"改动前的 index"一起存一份——
      // 归档读取以 index.order 为准，只把文件放回去而不恢复 order 是读不出来的
      await backupIndexSnapshot(dir);
      console.warn(`[session-archive] ${retired.length} 个会话被移出存档（已备份到 .removed/）：${retired.slice(0, 5).join(", ")}${retired.length > 5 ? " …" : ""}`);
      await pruneRemovedBackups(dir);
    }
    entries = orderedIds.map((id) => ({ id, file: encodeSessionId(id) }));
    for (const id of [...byId.keys()]) {
      if (!orderedIds.includes(id)) {
        byId.delete(id);
        fingerprints.delete(id);
      }
    }
    await writeIndex();
    return { blocked: false, retired: retired.length };
  };

  const withArchive = (job) => enqueue(async () => {
    await ensureMigrated();
    return job();
  });

  return {
    // 全量装载（主进程各只读消费方：历史检索、会话工具、渠道工作区推导等）
    loadAll(): any {
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

    /**
     * 同步读取单会话。DSH 插件按**同步**语义调用 sessions.get(id)
     * （实测 dsh-context 的 detail 路由：getSession(sessionId) 直接当对象用），
     * 异步版本会让它拿到一个 Promise，投影自然算不出来。
     * 已装载的会话在 byId 里，未装载的按 index 读文件。
     */
    getSync(sessionId) {
      const key = String(sessionId || "");
      if (!key) return undefined;
      if (byId.has(key)) return byId.get(key);
      const entry = entries.find((item) => item.id === key);
      if (!entry) return undefined;
      try {
        const session = JSON.parse(readFileSync(path.join(dir, entry.file), "utf8"));
        if (session?.id) {
          byId.set(String(session.id), session);
          fingerprints.set(String(session.id), contentFingerprint(session));
          return session;
        }
      } catch {
        // 文件损坏等：如实当作读不到
      }
      return undefined;
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

    // 渲染端增量：changed 原样写入、removed 删除、order 作为权威顺序；
    // activeId 非空时更新持久化的选中会话（persistOrder 会重写 index.json）
    async applyDelta({ changed = [], removed = [], order = [], activeId: nextActiveId } = {} as any) {
      return withArchive(async () => {
        for (const session of changed) {
          if (!session?.id) continue;
          const key = String(session.id);
          await writeSessionFile(session);
          byId.set(key, session);
          fingerprints.set(key, contentFingerprint(session));
        }
        const removedStamp = new Date().toISOString().replace(/[:.]/g, "-");
        for (const id of removed) {
          const key = String(id || "");
          if (!key) continue;
          // 显式删除也先备份：用户误操作/渲染端 bug 都可回滚
          await retireSessionFile(dir, encodeSessionId(key), removedStamp);
          byId.delete(key);
          fingerprints.delete(key);
        }
        await pruneRemovedBackups(dir);
        if (typeof nextActiveId === "string" && nextActiveId) activeId = nextActiveId;
        await persistOrder(order.map((id) => String(id)), new Set(removed.map(String)));
      });
    },

    // 渲染端最后选中的会话：对应会话仍存在则返回它，否则空串（由调用方回退）
    getActiveId() {
      return withArchive(() => (entries.some((entry) => entry.id === activeId) ? activeId : ""));
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

    // Publication and source retirement share the same archive operation queue.
    async publishDshTask(session, source = undefined, signal = undefined) {
      return withArchive(async () => {
        signal?.throwIfAborted();
        if(entries.some(entry=>entry.id===session.id))throw new Error('这个任务编号已经被其他任务使用');
        if(source){
          const current=await readSession(source.id);
          if(!current||current.runtime!=='dsh'||current.createdAt!==source.createdAt||current.workspacePath!==source.workspacePath)
            throw new Error('原任务已经删除或更换工作目录，请重新复制');
        }
        await writeSessionFile(session);byId.set(session.id,session);fingerprints.set(session.id,contentFingerprint(session));
        entries=[{id:session.id,file:encodeSessionId(session.id)},...entries];await writeIndex();
      });
    },

    // One root update preserves all other archive entries and their current order.
    async replace(session) {
      return withArchive(async () => {
        if (!session?.id) return;
        const key=String(session.id);
        await writeSessionFile(session);
        byId.set(key,session);fingerprints.set(key,contentFingerprint(session));
        if (!entries.some(entry=>entry.id===key)) entries=[{id:key,file:encodeSessionId(key)},...entries];
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
