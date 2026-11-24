import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compressImageBufferForModel,
  localImagePathFromSource,
  readLocalImageData,
  readLocalImageForModel,
  registerLocalImageIpc,
} from "../electron/local-image.mts";

test("助手回复可以识别 macOS、Linux 和 Windows 的本地图片地址", () => {
  const windowsSpacedPath = "C:\\Users\\demo\\现场 照片.png";
  const windowsNetworkPath = "\\\\server\\share\\现场 照片.png";
  assert.equal(localImagePathFromSource("/Users/demo/Pictures/现场照片.png"), "/Users/demo/Pictures/现场照片.png");
  assert.equal(localImagePathFromSource("file:///home/demo/Pictures/a%20b.jpg"), "/home/demo/Pictures/a b.jpg");
  assert.equal(localImagePathFromSource("C:/Users/demo/Pictures/a b.webp"), "C:/Users/demo/Pictures/a b.webp");
  assert.equal(localImagePathFromSource("file:///C:/Users/demo/Pictures/a%20b.jpeg"), "C:/Users/demo/Pictures/a b.jpeg");
  assert.equal(localImagePathFromSource("file://server/share/a%20b.png"), "//server/share/a b.png");
  assert.equal(localImagePathFromSource("%5Cserver%5Cshare%5Ca.png"), "\\\\server\\share\\a.png");
  assert.equal(localImagePathFromSource(encodeURI(windowsSpacedPath)), windowsSpacedPath);
  assert.equal(localImagePathFromSource(encodeURI(windowsNetworkPath)), windowsNetworkPath);
  assert.equal(localImagePathFromSource("/Users/demo/Pictures/100%20done.png"), "/Users/demo/Pictures/100%20done.png");
});

test("网络地址、相对地址和非图片文件不会被当成本地图片", () => {
  assert.equal(localImagePathFromSource("https://example.com/a.png"), "");
  assert.equal(localImagePathFromSource("./a.png"), "");
  assert.equal(localImagePathFromSource("/Users/demo/secrets.txt"), "");
  assert.equal(localImagePathFromSource("file:///Users/demo/vector.svg"), "");
});

test("读取本地图片后返回浏览器可以直接显示的内容", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-local-image-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, "preview.png");
  const bytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
  await fs.writeFile(imagePath, bytes);

  const result = await readLocalImageData(imagePath);

  assert.equal(result.ok, true);
  assert.equal(result.dataUrl, `data:image/png;base64,${bytes.toString("base64")}`);
});

test("Markdown 编码的中英文空格路径可读取，真实百分号文件名优先保持原样", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-local-image-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const spacedPath = path.join(directory, "现场 照片.png");
  const percentPath = path.join(directory, "100%20done.png");
  const spacedBytes = Buffer.from("spaced-image");
  const percentBytes = Buffer.from("percent-image");
  await fs.writeFile(spacedPath, spacedBytes);
  await fs.writeFile(percentPath, percentBytes);

  const encodedResult = await readLocalImageData(encodeURI(spacedPath));
  const percentResult = await readLocalImageData(percentPath);

  assert.equal(encodedResult.ok, true);
  assert.equal(encodedResult.dataUrl, `data:image/png;base64,${spacedBytes.toString("base64")}`);
  assert.equal(percentResult.ok, true);
  assert.equal(percentResult.dataUrl, `data:image/png;base64,${percentBytes.toString("base64")}`);
});

test("不存在或过大的图片会返回可读错误", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-local-image-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, "large.png");
  await fs.writeFile(imagePath, Buffer.alloc(5));

  const missing = await readLocalImageData(path.join(directory, "missing.png"));
  const tooLarge = await readLocalImageData(imagePath, { maxBytes: 4 });

  assert.equal(missing.ok, false);
  assert.match(missing.error, /不存在|读取失败/);
  assert.equal(tooLarge.ok, false);
  assert.match(tooLarge.error, /过大/);
});

test("桌面窗口可以通过受控入口读取本地图片", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-local-image-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, "preview.png");
  await fs.writeFile(imagePath, Buffer.from("89504e470d0a1a0a", "hex"));
  const handlers = new Map();
  registerLocalImageIpc(
    { handle: (name, handler) => handlers.set(name, handler) },
    { isTrustedSender: (event) => event.senderFrame.url === "file:///app/index.html" },
  );

  const result = await handlers.get("local-image:read")({ senderFrame: { url: "file:///app/index.html" } }, imagePath);
  const rejected = await handlers.get("local-image:read")({ senderFrame: { url: "https://example.com/" } }, imagePath);

  assert.equal(result.ok, true);
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /不允许/);
});

test("readLocalImageForModel 对小图原样返回且不重编码", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dyworker-local-image-model-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const imagePath = path.join(directory, "tiny.png");
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await fs.writeFile(imagePath, tinyPng);

  let decoderCalled = false;
  const result = await readLocalImageForModel(imagePath, {
    nativeImageImpl: {
      createFromBuffer() {
        decoderCalled = true;
        return null;
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.compressed, false);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.dataUrl, `data:image/png;base64,${tinyPng.toString("base64")}`);
  assert.equal(decoderCalled, false);
});

test("compressImageBufferForModel 对超大分辨率图按长边缩放并渐进转为 JPEG 压缩", async () => {
  const resizeCalls = [];
  const jpegCalls = [];
  const makeFakeImage = (width, height) => ({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: ({ width: nextW, height: nextH }) => {
      resizeCalls.push({ width: nextW, height: nextH });
      return makeFakeImage(nextW, nextH);
    },
    toPNG: () => Buffer.alloc(3_000_000, 0x11),
    toJPEG: (quality) => {
      jpegCalls.push({ width, height, quality });
      if (width > 1600 && quality >= 72) return Buffer.alloc(1_800_000, 0x22);
      return Buffer.alloc(450_000, 0x33);
    },
  });

  const oversizedPng = Buffer.alloc(4_000_000, 0xaa);
  const result = await compressImageBufferForModel(oversizedPng, "image/png", {
    maxEdge: 2048,
    targetBytes: 1_200_000,
    hardMaxBytes: 2_600_000,
    nativeImageImpl: {
      createFromBuffer: () => makeFakeImage(3840, 2486),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.compressed, true);
  assert.equal(result.mimeType, "image/jpeg");
  assert.ok(result.buffer.length <= 1_200_000);
  assert.deepEqual(resizeCalls[0], { width: 2048, height: 1326 });
  assert.ok(jpegCalls.some((call) => call.width === 1600 && call.quality === 72));
});

test("compressImageBufferForModel 无 nativeImage 且超过硬上限时返回可读错误", async () => {
  const huge = Buffer.alloc(3_000_000, 0xff);
  const result = await compressImageBufferForModel(huge, "image/png", {
    targetBytes: 1_200_000,
    hardMaxBytes: 2_600_000,
    nativeImageImpl: null,
  });

  assert.equal(result.ok, false);
  assert.match(result.error || "", /图片体积过大/);
});
