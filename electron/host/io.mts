// host 内部 JSON 读写：与 main.mts 的 readJson/writeJson 同语义（原子写、
// 并发串行化、敏感文件 0600）。后续 IPC 装配收尾时 main 的同名工具会收敛到这里。
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

// 含密钥/凭据的落盘文件收紧到仅属主可读写（safeStorage 不可用时的明文回退也受保护）
const SENSITIVE_JSON_FILES = new Set(["settings.json", "imported-passwords.json", "channel-credentials.json"]);

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

// 同一文件的并发写入串行化 + 唯一临时文件名：避免多个写入方共用同一个 .tmp，
// 导致 rename 互相踩踏（ENOENT 未捕获异常）
const jsonWriteChains = new Map();

export async function writeJson(file, value) {
  const previous = jsonWriteChains.get(file) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporary, file);
    if (SENSITIVE_JSON_FILES.has(path.basename(file))) await fs.chmod(file, 0o600).catch(() => {});
  });
  jsonWriteChains.set(file, next);
  try {
    await next;
  } finally {
    if (jsonWriteChains.get(file) === next) jsonWriteChains.delete(file);
  }
}
