import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(new URL("../electron/main.mjs", import.meta.url), "utf8");
const handler = source.match(/ipcMain\.on\("window:set-ignore-mouse",[\s\S]*?\n\}\);/)[0];

for (const maximized of [false, true]) {
  for (const shadow of [false, true]) {
    test(`Linux 窗口经过边缘后仍能接收点击：maximized=${maximized}, shadow=${shadow}`, () => {
      let listener;
      let ignoresMouse = true; // 也必须能够恢复旧的忽略状态
      let receivedClicks = 0;
      const win = {
        webContents: {},
        isDestroyed: () => false,
        isMaximized: () => maximized,
        setIgnoreMouseEvents: (value) => { ignoresMouse = value; },
      };
      vm.runInNewContext(handler, {
        ipcMain: { on: (_name, fn) => { listener = fn; } },
        process: { platform: "linux" },
        mainWindow: win,
        currentWindowShadow: shadow,
        startIgnoreMouseRecovery() {},
        stopIgnoreMouseRecovery() {},
      });
      // 快速经过边缘再点正文；不假设轮询能够读取光标或及时执行。
      for (const request of [true, true, false, true]) {
        listener({ sender: win.webContents }, request);
        if (!ignoresMouse) receivedClicks++;
      }
      assert.equal(receivedClicks, 4);
      ignoresMouse = true;
      listener({ sender: {} }, false);
      assert.equal(ignoresMouse, true, "其他页面不能控制主窗口");
    });
  }
}
