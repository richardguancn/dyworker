// 从 Chromium 系浏览器导入 localStorage（SPA 站点把登录令牌存在这里，只导 Cookie 无法迁移登录态）。
// 不引入原生依赖：自带一个够用的只读 LevelDB 解析器（log + sstable + Snappy），
// 读取 <画像>/Local Storage/leveldb 下的所有记录，按内部序列号合并（新值覆盖旧值、墓碑删除生效）。
// Chromium 的 localStorage 键格式：'_' + origin + '\x00' + 类型字节 + 键内容，
// 类型字节 0x01 = Latin-1、0x00 = UTF-16LE（与常见文档相反，按 Chromium 实际数据校准）。
// 值同样自带 1 字节编码标签（语义相同）+ 内容，导入时必须剥掉，否则令牌首部多一个控制字符。
import { promises as fs } from "node:fs";
import path from "node:path";

// 防护上限：localStorage 里偶尔有大体积缓存（如编辑器草稿），导入只想要登录态这类小数据。
// 限量按 origin 维度做，不用全局总量——否则一个大站点会把排在后面的站点（正好是登录态目标）全部挤掉。
const MAX_VALUE_BYTES = 512 * 1024;
const MAX_ORIGINS = 500;
const MAX_ORIGIN_BYTES = 2 * 1024 * 1024;

// ---- 基础读取原语 ----

function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  let p = pos;
  while (p < buf.length && shift <= 49) {
    const byte = buf[p++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, p];
    shift += 7;
  }
  return [result, p];
}

// Snappy 原始块格式解压（LevelDB 用的是 raw 格式，不是 framed 格式）
export function snappyDecompress(input) {
  const [expected, startPos] = readVarint(input, 0);
  let out = Buffer.alloc(Math.max(expected, 64));
  let outLen = 0;
  const ensure = (extra) => {
    if (outLen + extra > out.length) {
      const next = Buffer.alloc(Math.max(out.length * 2, outLen + extra));
      out.copy(next, 0, 0, outLen);
      out = next;
    }
  };
  let pos = startPos;
  while (pos < input.length) {
    const tag = input[pos++];
    const type = tag & 0x03;
    if (type === 0) {
      // 字面量：tag>>2 < 60 时长度即它+1，否则读 1-4 字节小端长度
      let length = tag >> 2;
      if (length < 60) {
        length += 1;
      } else {
        const lengthBytes = length - 59;
        length = 0;
        for (let i = 0; i < lengthBytes; i++) length += input[pos++] * 2 ** (8 * i);
        length += 1;
      }
      ensure(length);
      input.copy(out, outLen, pos, pos + length);
      outLen += length;
      pos += length;
    } else {
      let length;
      let offset;
      if (type === 1) {
        length = ((tag >> 2) & 0x07) + 4;
        offset = (tag >> 5) * 256 + input[pos++];
      } else if (type === 2) {
        length = (tag >> 2) + 1;
        offset = input[pos] + input[pos + 1] * 256;
        pos += 2;
      } else {
        length = (tag >> 2) + 1;
        offset = (input[pos] + input[pos + 1] * 256 + input[pos + 2] * 65536 + input[pos + 3] * 16777216) >>> 0;
        pos += 4;
      }
      ensure(length);
      // 逐字节拷贝以支持重叠区间（offset < length 时的自引用展开）
      for (let i = 0; i < length; i++) {
        out[outLen] = out[outLen - offset];
        outLen += 1;
      }
    }
  }
  return out.subarray(0, outLen);
}

// ---- LevelDB log（WriteBatch 序列，32KB 块 + 7 字节记录头，CRC 跳过不验）----

function* readLogBatches(buf) {
  const BLOCK_SIZE = 32768;
  let offset = 0;
  let fragments = [];
  while (offset + 7 <= buf.length) {
    const blockRest = BLOCK_SIZE - (offset % BLOCK_SIZE);
    if (blockRest < 7) { offset += blockRest; continue; }
    const length = buf.readUInt16LE(offset + 4);
    const type = buf[offset + 6];
    if (length === 0 && type === 0) { offset += blockRest; continue; } // 块尾填充
    if (offset + 7 + length > buf.length) break; // 半截记录（浏览器运行中复制所致），到此为止
    const payload = buf.subarray(offset + 7, offset + 7 + length);
    offset += 7 + length;
    if (type === 1) yield payload; // FULL
    else if (type === 2) fragments = [payload]; // FIRST
    else if (type === 3) fragments.push(payload); // MIDDLE
    else if (type === 4) { fragments.push(payload); yield Buffer.concat(fragments); fragments = []; } // LAST
    // type 0 或其他：损坏数据，跳过
  }
}

function parseWriteBatch(batch, sink) {
  if (batch.length < 12) return;
  const sequence = Number(batch.readBigUInt64LE(0));
  let pos = 12;
  let index = 0;
  while (pos < batch.length) {
    const type = batch[pos++];
    const [keyLength, p1] = readVarint(batch, pos);
    pos = p1;
    const key = batch.subarray(pos, pos + keyLength);
    pos += keyLength;
    if (type === 1) { // kTypeValue
      const [valueLength, p2] = readVarint(batch, pos);
      pos = p2;
      const value = batch.subarray(pos, pos + valueLength);
      pos += valueLength;
      sink.push({ key, value, sequence: sequence + index, deleted: false });
    } else if (type === 0) { // kTypeDeletion
      sink.push({ key, value: null, sequence: sequence + index, deleted: true });
    } else {
      break; // 无法识别的记录类型，本批次剩余部分放弃
    }
    index += 1;
  }
}

// ---- LevelDB sstable（footer → index 块 → 数据块，块可 Snappy 压缩）----

function readSSTableBlock(buf, offset, size) {
  if (offset < 0 || size < 0 || offset + size + 5 > buf.length) return null;
  const compression = buf[offset + size]; // 块尾 5 字节：1 字节压缩类型 + 4 字节 CRC
  const raw = buf.subarray(offset, offset + size);
  if (compression === 1) {
    try {
      return snappyDecompress(raw);
    } catch {
      return null;
    }
  }
  if (compression === 0) return raw;
  return null;
}

function parseBlockEntries(block) {
  const entries = [];
  if (!block || block.length < 4) return entries;
  const restartCount = block.readUInt32LE(block.length - 4);
  const restartOffset = block.length - 4 - restartCount * 4;
  if (restartOffset < 0) return entries;
  let pos = 0;
  let lastKey = Buffer.alloc(0);
  while (pos < restartOffset) {
    const [shared, p1] = readVarint(block, pos);
    const [nonShared, p2] = readVarint(block, p1);
    const [valueLength, p3] = readVarint(block, p2);
    pos = p3;
    if (pos + nonShared + valueLength > restartOffset) break;
    const key = Buffer.concat([lastKey.subarray(0, shared), block.subarray(pos, pos + nonShared)]);
    pos += nonShared;
    const value = block.subarray(pos, pos + valueLength);
    pos += valueLength;
    entries.push({ key, value });
    lastKey = key;
  }
  return entries;
}

function parseSSTable(buf, sink) {
  if (buf.length < 53) return;
  const footer = buf.subarray(buf.length - 48);
  // footer：metaindex 句柄（offset/size 两个 varint）+ index 句柄 + 填充 + 8 字节魔数
  let pos = 0;
  const [, p1] = readVarint(footer, pos); // metaindex offset
  const [, p2] = readVarint(footer, p1); // metaindex size
  const [indexOffset, p3] = readVarint(footer, p2);
  const [indexSize] = readVarint(footer, p3);
  const indexBlock = readSSTableBlock(buf, indexOffset, indexSize);
  if (!indexBlock) return;
  for (const { value: handle } of parseBlockEntries(indexBlock)) {
    const [blockOffset, q1] = readVarint(handle, 0);
    const [blockSize] = readVarint(handle, q1);
    const dataBlock = readSSTableBlock(buf, blockOffset, blockSize);
    if (!dataBlock) continue;
    for (const entry of parseBlockEntries(dataBlock)) {
      // 数据块的键是内部键：用户键 + 8 字节标签（序列号 << 8 | 类型，1=值 0=删除）
      if (entry.key.length < 8) continue;
      const tag = entry.key.readBigUInt64LE(entry.key.length - 8);
      sink.push({
        key: entry.key.subarray(0, entry.key.length - 8),
        value: entry.value,
        sequence: Number(tag >> 8n),
        deleted: Number(tag & 0xffn) === 0,
      });
    }
  }
}

// ---- Chromium localStorage 键值解码 ----

// '_' + origin + '\x00' + 类型字节 + 键；值的编码由值自己的首字节标签决定，与键无关。
// 注意与常见文档相反：0x01 = Latin-1（单字节），0x00 = UTF-16LE（按 Chromium 135+ 实际数据校准）
function decodeEntryKey(key) {
  if (key.length < 3 || key[0] !== 0x5f) return null; // '_'
  const separator = key.indexOf(0x00, 1);
  if (separator < 1 || separator + 1 >= key.length) return null;
  const origin = key.subarray(1, separator).toString("utf8");
  const latin1 = key[separator + 1] === 1;
  const text = key.subarray(separator + 2).toString(latin1 ? "latin1" : "utf16le");
  return { origin, key: text, latin1 };
}

// 读取 leveldb 目录副本，返回 { [origin]: { [key]: value } }（仅 http/https，含量级防护）
export async function readLocalStorageLeveldb(leveldbDir) {
  let fileNames = [];
  try {
    fileNames = await fs.readdir(leveldbDir);
  } catch {
    return {};
  }
  const records = [];
  // sstable 与 log 全部读取，之后按序列号合并——MANIFEST 只影响效率不影响结果
  for (const name of fileNames) {
    const filePath = path.join(leveldbDir, name);
    let buf = null;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      continue;
    }
    try {
      if (/\.(ldb|sst)$/i.test(name)) parseSSTable(buf, records);
      else if (/\.log$/i.test(name)) {
        for (const batch of readLogBatches(buf)) parseWriteBatch(batch, records);
      }
    } catch {
      // 单个文件损坏（运行中复制的半截文件）不影响其余数据
    }
  }
  // 合并：同一用户键取序列号最大的一条；删除墓碑则移除
  const latest = new Map(); // hex(key) → record
  for (const record of records) {
    const id = record.key.toString("hex");
    const existing = latest.get(id);
    if (!existing || record.sequence >= existing.sequence) latest.set(id, record);
  }
  const result = {};
  const originBytes = new Map();
  for (const record of latest.values()) {
    if (record.deleted || !record.value) continue;
    const decoded = decodeEntryKey(record.key);
    if (!decoded) continue;
    if (!/^https?:\/\//i.test(decoded.origin)) continue; // 跳过 chrome-extension:// 等
    if (record.value.length < 1) continue; // 值至少是 1 字节编码标签
    // 值格式：1 字节编码标签（0x01 = Latin-1，0x00 = UTF-16LE，与键的标签语义相同）+ 内容
    const valueLatin1 = record.value[0] === 1;
    const payload = record.value.subarray(1);
    if (payload.length > MAX_VALUE_BYTES) continue;
    if (!result[decoded.origin]) {
      if (Object.keys(result).length >= MAX_ORIGINS) continue;
      result[decoded.origin] = {};
      originBytes.set(decoded.origin, 0);
    }
    const used = originBytes.get(decoded.origin) || 0;
    if (used + payload.length > MAX_ORIGIN_BYTES) continue;
    originBytes.set(decoded.origin, used + payload.length);
    result[decoded.origin][decoded.key] = payload.toString(valueLatin1 ? "latin1" : "utf16le");
  }
  return result;
}
