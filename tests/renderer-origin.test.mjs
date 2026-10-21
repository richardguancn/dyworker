import test from "node:test";
import assert from "node:assert/strict";
import { isTrustedAppRendererUrl } from "../electron/renderer-origin.mts";

const localEntry = "file:///Applications/DYWorker.app/Contents/Resources/app.asar/dist/client/index.html";
const devEntry = "http://127.0.0.1:5173";

test("直接启动构建版本或开发服务器失败后，本地应用入口仍可读取记录", () => {
  assert.equal(isTrustedAppRendererUrl(localEntry, localEntry, devEntry), true);
  assert.equal(isTrustedAppRendererUrl(localEntry, localEntry), true);
  assert.equal(isTrustedAppRendererUrl(`${localEntry}?view=chat#latest`, localEntry, devEntry), true);
});

test("开发服务器只在开发环境接受，且必须同源", () => {
  assert.equal(isTrustedAppRendererUrl(`${devEntry}/`, localEntry, devEntry), true);
  assert.equal(isTrustedAppRendererUrl(`${devEntry}/`, localEntry), false);
  assert.equal(isTrustedAppRendererUrl("http://127.0.0.1:5174/", localEntry, devEntry), false);
  assert.equal(isTrustedAppRendererUrl("https://example.com/", localEntry, devEntry), false);
});

test("其他本地文件、远程文件地址和无效地址都不能调用应用能力", () => {
  for (const url of [
    "file:///tmp/index.html",
    "file://example.com/Applications/DYWorker.app/Contents/Resources/app.asar/dist/client/index.html",
    localEntry.replace("index.html", "other.html"),
    "about:blank",
    "data:text/html,test",
    "invalid",
    undefined,
  ]) {
    assert.equal(isTrustedAppRendererUrl(url, localEntry, devEntry), false, String(url));
  }
});
