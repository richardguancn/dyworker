import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectOrphanAssets,
  commitStagedImage,
  discardStagedImage,
  importAppearanceImage,
  inspectImageBuffer,
  readAppearanceImage,
  removeAppearanceImage,
} from "../electron/appearance.mjs";

async function makeTmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyw-appearance-assets-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function pngChunk(type, data) {
  // 真实 PNG chunk = 长度(4) + 类型(4) + 数据 + CRC(4)
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  return chunk;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makePng(width, height, { animated = false } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type truecolor
  const parts = [PNG_SIGNATURE, pngChunk("IHDR", ihdr)];
  if (animated) parts.push(pngChunk("acTL", Buffer.alloc(8)));
  parts.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function makeJpeg(width, height) {
  const sof = Buffer.alloc(15);
  sof.writeUInt16BE(0x0011, 0); // segment length 17
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0]), sof]);
}

function webpChunk(type, data) {
  // WebP chunk = fourcc(4) + 小端 size(4) + 数据（偶数对齐）
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function makeWebpVp8x(width, height, { animated = false } = {}) {
  const data = Buffer.alloc(10);
  data[0] = animated ? 0x02 : 0x00;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  const chunks = [webpChunk("VP8X", data)];
  if (animated) chunks.push(webpChunk("ANIM", Buffer.alloc(6)));
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

function makeWebpVp8(width, height) {
  const data = Buffer.alloc(10);
  data[3] = 0x9d;
  data[4] = 0x01;
  data[5] = 0x2a;
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), webpChunk("VP8 ", data)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

test("inspectImageBuffer：PNG 格式与尺寸", async () => {
  const result = await inspectImageBuffer(makePng(3, 2));
  assert.deepEqual(result, { ok: true, format: "png", width: 3, height: 2, animated: false });
});

test("inspectImageBuffer：PNG acTL 动图检测", async () => {
  const still = await inspectImageBuffer(makePng(1, 1));
  assert.equal(still.animated, false);
  const animated = await inspectImageBuffer(makePng(1, 1, { animated: true }));
  assert.equal(animated.ok, true);
  assert.equal(animated.animated, true);
});

test("inspectImageBuffer：JPEG SOF0 尺寸解析", async () => {
  const result = await inspectImageBuffer(makeJpeg(1920, 1080));
  assert.deepEqual(result, { ok: true, format: "jpeg", width: 1920, height: 1080, animated: false });
});

test("inspectImageBuffer：WebP VP8X 与动图检测", async () => {
  const still = await inspectImageBuffer(makeWebpVp8x(640, 480));
  assert.deepEqual(still, { ok: true, format: "webp", width: 640, height: 480, animated: false });
  const animated = await inspectImageBuffer(makeWebpVp8x(640, 480, { animated: true }));
  assert.equal(animated.animated, true);
});

test("inspectImageBuffer：WebP VP8 有损尺寸解析", async () => {
  const result = await inspectImageBuffer(makeWebpVp8(800, 600));
  assert.equal(result.ok, true);
  assert.equal(result.format, "webp");
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
});

test("inspectImageBuffer：非图片与截断数据拒绝", async () => {
  for (const bad of [Buffer.from("hello world"), Buffer.from("RIFF....AVI "), Buffer.alloc(2), Buffer.alloc(0)]) {
    const result = await inspectImageBuffer(bad);
    assert.equal(result.ok, false, `应拒绝 ${bad.toString("hex").slice(0, 16)}`);
    assert.equal(typeof result.error, "string");
  }
  const truncated = makePng(4, 4).subarray(0, 20);
  const result = await inspectImageBuffer(truncated);
  assert.equal(result.ok, false);
});

test("importAppearanceImage：正常导入写入 staging", async (t) => {
  const dir = await makeTmpDir(t);
  const source = path.join(dir, "源 文件.png");
  await fs.writeFile(source, makePng(10, 8));
  const assetsDir = path.join(dir, "assets");
  const imported = await importAppearanceImage(assetsDir, source);
  assert.equal(imported.ok, true);
  assert.match(imported.imageId, /^[a-f0-9]{32}\.png$/);
  assert.equal(imported.width, 10);
  assert.equal(imported.height, 8);
  assert.equal(imported.staging, true);
  const staged = await fs.readFile(path.join(assetsDir, "staging", imported.imageId));
  assert.deepEqual(staged, makePng(10, 8));
});

test("importAppearanceImage：process 钩子可替换输出，异常被拒绝", async (t) => {
  const dir = await makeTmpDir(t);
  const source = path.join(dir, "in.png");
  await fs.writeFile(source, makePng(10, 8));
  const assetsDir = path.join(dir, "assets");
  const imported = await importAppearanceImage(assetsDir, source, {
    process: async (buffer, info) => {
      assert.equal(info.format, "png");
      assert.equal(info.width, 10);
      return Buffer.concat([buffer, Buffer.from([0])]);
    },
  });
  assert.equal(imported.ok, true);
  const staged = await fs.readFile(path.join(assetsDir, "staging", imported.imageId));
  assert.equal(staged.length, makePng(10, 8).length + 1);

  const failed = await importAppearanceImage(assetsDir, source, {
    process: async () => { throw new Error("nativeImage 解码失败"); },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /nativeImage/);
});

test("importAppearanceImage：WebP 经 process 转为 PNG 时自动更新格式与尺寸", async (t) => {
  const dir = await makeTmpDir(t);
  const source = path.join(dir, "photo.webp");
  await fs.writeFile(source, makeWebpVp8(20, 15));
  const assetsDir = path.join(dir, "assets");
  const imported = await importAppearanceImage(assetsDir, source, {
    process: async (_buffer, info) => {
      assert.equal(info.format, "webp");
      return makePng(10, 8);
    },
  });
  assert.equal(imported.ok, true);
  assert.match(imported.imageId, /^[a-f0-9]{32}\.png$/);
  assert.equal(imported.width, 10);
  assert.equal(imported.height, 8);
});

test("importAppearanceImage：大小、像素与动图限制", async (t) => {
  const dir = await makeTmpDir(t);
  const assetsDir = path.join(dir, "assets");

  const big = path.join(dir, "big.png");
  await fs.writeFile(big, makePng(1, 1));
  const tooLarge = await importAppearanceImage(assetsDir, big, { fileSize: 21 * 1024 * 1024 });
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.error, /20MB/);

  const hugePixels = path.join(dir, "huge.png");
  await fs.writeFile(hugePixels, makePng(8000, 6000));
  const tooMany = await importAppearanceImage(assetsDir, hugePixels);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /4000 万/);
  assert.equal(tooMany.width, undefined);

  const anim = path.join(dir, "anim.png");
  await fs.writeFile(anim, makePng(1, 1, { animated: true }));
  const animated = await importAppearanceImage(assetsDir, anim);
  assert.equal(animated.ok, false);
  assert.match(animated.error, /动图/);

  const notImage = path.join(dir, "fake.png");
  await fs.writeFile(notImage, Buffer.from("not an image"));
  const fake = await importAppearanceImage(assetsDir, notImage);
  assert.equal(fake.ok, false);

  const missing = await importAppearanceImage(assetsDir, path.join(dir, "missing.png"));
  assert.equal(missing.ok, false);
});

test("readAppearanceImage：staging 与正式区都可读，mime 正确", async (t) => {
  const dir = await makeTmpDir(t);
  const source = path.join(dir, "in.jpg");
  await fs.writeFile(source, makeJpeg(2, 2));
  const assetsDir = path.join(dir, "assets");
  const imported = await importAppearanceImage(assetsDir, source);
  assert.equal(imported.ok, true);

  const fromStaging = await readAppearanceImage(assetsDir, imported.imageId);
  assert.equal(fromStaging.ok, true);
  assert.equal(fromStaging.mime, "image/jpeg");
  assert.deepEqual(fromStaging.data, makeJpeg(2, 2));

  await commitStagedImage(assetsDir, imported.imageId);
  const fromCommitted = await readAppearanceImage(assetsDir, imported.imageId);
  assert.equal(fromCommitted.ok, true);
  assert.deepEqual(fromCommitted.data, makeJpeg(2, 2));
});

test("readAppearanceImage：路径穿越与非法 ID 全部拒绝", async (t) => {
  const dir = await makeTmpDir(t);
  const assetsDir = path.join(dir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const outside = path.join(dir, "secret.txt");
  await fs.writeFile(outside, "secret", "utf8");

  for (const bad of ["../secret.txt", "..%2fsecret.txt", "a/b.png", "abc.png", "ABCDEF0123.png", "null", "", 42, null]) {
    const result = await readAppearanceImage(assetsDir, bad);
    assert.equal(result.ok, false, `ID ${JSON.stringify(bad)} 应被拒绝`);
  }
  const escape = await readAppearanceImage(assetsDir, "../../etc/hosts");
  assert.equal(escape.ok, false);

  const missing = await readAppearanceImage(assetsDir, "abcdef0123456789.png");
  assert.equal(missing.ok, false);
});

test("commitStagedImage / discardStagedImage / removeAppearanceImage 语义", async (t) => {
  const dir = await makeTmpDir(t);
  const source = path.join(dir, "in.webp");
  await fs.writeFile(source, makeWebpVp8(5, 5));
  const assetsDir = path.join(dir, "assets");
  const imported = await importAppearanceImage(assetsDir, source);
  const { imageId } = imported;

  // commit：staging → 正式区
  const committed = await commitStagedImage(assetsDir, imageId);
  assert.equal(committed.ok, true);
  await fs.access(path.join(assetsDir, imageId));
  await assert.rejects(fs.access(path.join(assetsDir, "staging", imageId)));

  // discard 只删 staging：正式区不动
  const discardCommitted = await discardStagedImage(assetsDir, imageId);
  assert.equal(discardCommitted.ok, true);
  assert.equal(discardCommitted.discarded, false);
  await fs.access(path.join(assetsDir, imageId));

  // remove 删正式区
  const removed = await removeAppearanceImage(assetsDir, imageId);
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  await assert.rejects(fs.access(path.join(assetsDir, imageId)));
  const removedAgain = await removeAppearanceImage(assetsDir, imageId);
  assert.equal(removedAgain.removed, false);

  // discard 删暂存的
  const second = await importAppearanceImage(assetsDir, source);
  const discarded = await discardStagedImage(assetsDir, second.imageId);
  assert.equal(discarded.discarded, true);
  await assert.rejects(fs.access(path.join(assetsDir, "staging", second.imageId)));

  // 非法 ID
  assert.equal((await commitStagedImage(assetsDir, "../x.png")).ok, false);
  assert.equal((await discardStagedImage(assetsDir, "bad")).ok, false);
  assert.equal((await removeAppearanceImage(assetsDir, "a/b.webp")).ok, false);
  // staging 缺失时 commit 失败
  assert.equal((await commitStagedImage(assetsDir, second.imageId)).ok, false);
});

test("collectOrphanAssets：清理孤儿且不误删被引用与无关文件", async (t) => {
  const dir = await makeTmpDir(t);
  const assetsDir = path.join(dir, "assets");
  const staging = path.join(assetsDir, "staging");
  await fs.mkdir(staging, { recursive: true });

  const referenced = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1.png";
  const orphanFormal = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2.jpg";
  const orphanStaged = "ccccccccccccccccccccccccccccccc3.webp";
  const unrelated = "notes.txt";
  const subdir = "nested";
  for (const [area, name] of [
    [assetsDir, referenced],
    [assetsDir, orphanFormal],
    [staging, referenced],
    [staging, orphanStaged],
    [assetsDir, unrelated],
  ]) {
    await fs.writeFile(path.join(area, name), makePng(1, 1));
  }
  await fs.mkdir(path.join(assetsDir, subdir));
  await fs.writeFile(path.join(assetsDir, subdir, "ddddddddddddddddddddddddddddddd4.png"), makePng(1, 1));

  const result = await collectOrphanAssets(assetsDir, [referenced]);
  assert.equal(result.ok, true);
  assert.deepEqual([...result.removed].sort(), [orphanFormal, orphanStaged].sort());

  await fs.access(path.join(assetsDir, referenced));
  await fs.access(path.join(staging, referenced));
  await fs.access(path.join(assetsDir, unrelated));
  await fs.access(path.join(assetsDir, subdir, "ddddddddddddddddddddddddddddddd4.png"));
  await assert.rejects(fs.access(path.join(assetsDir, orphanFormal)));
  await assert.rejects(fs.access(path.join(staging, orphanStaged)));
});

test("collectOrphanAssets：assetsDir 不存在时不报错", async (t) => {
  const dir = await makeTmpDir(t);
  const result = await collectOrphanAssets(path.join(dir, "nope"), []);
  assert.deepEqual(result, { ok: true, removed: [] });
});
