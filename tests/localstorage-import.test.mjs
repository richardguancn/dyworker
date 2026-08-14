import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readLocalStorageLeveldb, snappyDecompress } from "../electron/localstorage-import.mjs";

// ---- 合成 LevelDB fixture 的构造工具（与 Chromium localStorage leveldb 同格式）----

function encodeVarint(value) {
  const bytes = [];
  let n = value;
  while (n >= 0x80) { bytes.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  bytes.push(n);
  return Buffer.from(bytes);
}

// localStorage 条目键：'_' + origin + \x00 + 类型字节 + 键（0x01=Latin-1，0x00=UTF-16LE）
function lsKey(origin, key, latin1 = true) {
  return Buffer.concat([
    Buffer.from(`_${origin}`, "utf8"),
    Buffer.from([0, latin1 ? 1 : 0]),
    Buffer.from(key, latin1 ? "latin1" : "utf16le"),
  ]);
}
// localStorage 条目值：1 字节编码标签（0x01=Latin-1，0x00=UTF-16LE）+ 内容（与真实 Chromium 落盘格式一致）
const lsValue = (value, latin1 = true) =>
  Buffer.concat([Buffer.from([latin1 ? 1 : 0]), Buffer.from(value, latin1 ? "latin1" : "utf16le")]);

function buildLogFile(batches) {
  const records = [];
  for (const batch of batches) {
    const parts = [Buffer.alloc(12)];
    parts[0].writeBigUInt64LE(BigInt(batch.sequence), 0);
    parts[0].writeUInt32LE(batch.ops.length, 8);
    for (const op of batch.ops) {
      parts.push(Buffer.from([op.del ? 0 : 1]));
      parts.push(encodeVarint(op.key.length), op.key);
      if (!op.del) parts.push(encodeVarint(op.value.length), op.value);
    }
    const body = Buffer.concat(parts);
    const header = Buffer.alloc(7); // CRC 置零（解析器不校验）
    header.writeUInt16LE(body.length, 4);
    header.writeUInt8(1, 6); // FULL 记录
    records.push(Buffer.concat([header, body]));
  }
  return Buffer.concat(records);
}

function buildBlock(entries, compress = false) {
  const parts = [];
  for (const entry of entries) {
    parts.push(encodeVarint(0), encodeVarint(entry.key.length), encodeVarint(entry.value.length), entry.key, entry.value);
  }
  const restartArray = Buffer.alloc(4); // restart[0] = 0
  const restartCount = Buffer.alloc(4);
  restartCount.writeUInt32LE(1, 0);
  const raw = Buffer.concat([...parts, restartArray, restartCount]);
  if (!compress) return { data: raw, type: 0 };
  // 纯字面量 Snappy 流：varint 未压缩长度 + 长字面量（长度用 1 字节跟随形式）
  const snappy = Buffer.concat([encodeVarint(raw.length), Buffer.from([(59 + 1) << 2, raw.length - 1]), raw]);
  return { data: snappy, type: 1 };
}

function buildSSTable(items, { compressDataBlock = false } = {}) {
  const dataEntries = items.map((item) => {
    const tag = Buffer.alloc(8);
    tag.writeBigUInt64LE((BigInt(item.sequence) << 8n) | BigInt(item.deleted ? 0 : 1), 0);
    return { key: Buffer.concat([item.userKey, tag]), value: item.value ?? Buffer.alloc(0) };
  }).sort((a, b) => Buffer.compare(a.key, b.key));
  const data = buildBlock(dataEntries, compressDataBlock);
  const meta = buildBlock([]);
  const handle = (offset, size) => Buffer.concat([encodeVarint(offset), encodeVarint(size)]);
  const index = buildBlock([{ key: Buffer.from("z"), value: handle(0, data.data.length) }]);
  const dataOffset = 0;
  const metaOffset = dataOffset + data.data.length + 5;
  const indexOffset = metaOffset + meta.data.length + 5;
  const footer = Buffer.alloc(48);
  const metaHandle = handle(metaOffset, meta.data.length);
  const indexHandle = handle(indexOffset, index.data.length);
  metaHandle.copy(footer, 0);
  indexHandle.copy(footer, metaHandle.length);
  const trailer = (type) => Buffer.concat([Buffer.from([type]), Buffer.alloc(4)]);
  return Buffer.concat([
    data.data, trailer(data.type),
    meta.data, trailer(meta.type),
    index.data, trailer(index.type),
    footer,
  ]);
}

async function withLeveldbDir(files, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-lsdb-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), content);
    }
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---- Snappy ----

test("snappyDecompress:字面量与拷贝（含重叠展开）", () => {
  // "hello"：前导 varint 长度 5 + 短字面量
  const literal = Buffer.concat([Buffer.from([5, (5 - 1) << 2]), Buffer.from("hello")]);
  assert.equal(snappyDecompress(literal).toString(), "hello");
  // "aaaa"：字面量 "a" + type-2 拷贝（offset 1, len 3，重叠自引用）
  const withCopy = Buffer.concat([Buffer.from([4, 0]), Buffer.from("a"), Buffer.from([((3 - 1) << 2) | 2, 1, 0])]);
  assert.equal(snappyDecompress(withCopy).toString(), "aaaa");
});

// ---- log / sstable / 合并 ----

test("log 文件：WriteBatch 解析与 localStorage 键值解码", async () => {
  const log = buildLogFile([
    { sequence: 1, ops: [{ key: lsKey("https://www.kimi.com", "access_token"), value: lsValue("header.payload.sig") }] },
    { sequence: 2, ops: [{ key: lsKey("https://a.example", "theme"), value: lsValue("dark") }] },
  ]);
  const data = await withLeveldbDir({ "000001.log": log }, readLocalStorageLeveldb);
  assert.equal(data["https://www.kimi.com"].access_token, "header.payload.sig");
  assert.equal(data["https://a.example"].theme, "dark");
});

test("sstable：未压缩与 Snappy 压缩数据块都能读取", async () => {
  const items = [
    { userKey: lsKey("https://www.kimi.com", "refresh_token"), value: lsValue("rt-abc"), sequence: 10 },
  ];
  const plain = await withLeveldbDir({ "000002.ldb": buildSSTable(items) }, readLocalStorageLeveldb);
  assert.equal(plain["https://www.kimi.com"].refresh_token, "rt-abc");
  const compressed = await withLeveldbDir(
    { "000003.ldb": buildSSTable(items, { compressDataBlock: true }) },
    readLocalStorageLeveldb,
  );
  assert.equal(compressed["https://www.kimi.com"].refresh_token, "rt-abc");
});

test("合并：序列号大的获胜，删除墓碑生效", async () => {
  const key = lsKey("https://a.example", "token");
  const sst = buildSSTable([
    { userKey: key, value: lsValue("old"), sequence: 5 },
    { userKey: lsKey("https://a.example", "stale"), value: lsValue("x"), sequence: 5 },
  ]);
  const log = buildLogFile([
    { sequence: 8, ops: [{ key, value: lsValue("new") }, { key: lsKey("https://a.example", "stale"), del: true }] },
  ]);
  const data = await withLeveldbDir({ "000002.ldb": sst, "000003.log": log }, readLocalStorageLeveldb);
  assert.equal(data["https://a.example"].token, "new", "log 里的新值覆盖 sstable 旧值");
  assert.equal(data["https://a.example"].stale, undefined, "墓碑删除的键不出现");
});

test("解码：UTF-16 条目与非 http(s) origin 过滤", async () => {
  const log = buildLogFile([
    { sequence: 1, ops: [{ key: lsKey("https://b.example", "中文键", false), value: lsValue("值内容", false) }] },
    { sequence: 2, ops: [{ key: lsKey("chrome-extension://abc", "k"), value: lsValue("v") }] },
  ]);
  const data = await withLeveldbDir({ "000001.log": log }, readLocalStorageLeveldb);
  assert.equal(data["https://b.example"]["中文键"], "值内容");
  assert.equal(data["chrome-extension://abc"], undefined, "扩展 origin 不导入");
});

test("值的首字节编码标签被剥掉（真实 Chromium 格式回归）", async () => {
  const log = buildLogFile([
    { sequence: 1, ops: [{ key: lsKey("https://www.kimi.com", "access_token"), value: lsValue("header.payload.sig") }] },
    { sequence: 2, ops: [{ key: lsKey("https://b.example", "中文", false), value: lsValue("某令牌值", false) }] },
  ]);
  const data = await withLeveldbDir({ "000001.log": log }, readLocalStorageLeveldb);
  const token = data["https://www.kimi.com"].access_token;
  assert.equal(token, "header.payload.sig");
  assert.ok(!/[\x00-\x1f]/.test(token), "解码后的值不含标签残留的控制字符");
  assert.equal(data["https://b.example"]["中文"], "某令牌值", "UTF-16 值同样剥标签解码");
});

test("半截/损坏文件不拖垮整体解析", async () => {
  const good = buildLogFile([
    { sequence: 1, ops: [{ key: lsKey("https://a.example", "k"), value: lsValue("v") }] },
  ]);
  const garbage = Buffer.from([0xff, 0xfe, 0x00, 0x13, 0x37]);
  const data = await withLeveldbDir({ "000001.log": good, "broken.ldb": garbage }, readLocalStorageLeveldb);
  assert.equal(data["https://a.example"].k, "v");
});
