// macOS 内置本机应用操作服务的单元测试。
// 真实图形会话端到端测试仅在 darwin 且设置 DYWORKER_CU_E2E=1 时运行。
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  desktopToolDefinitions,
  parsePngDimensions,
  unpackedResourcePath,
} from "../electron/macos-computer-use-server.mjs";
import { McpClient } from "../electron/mcp.mjs";

function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("macOS 工具清单包含权限检查、只读界面读取与受窗口保护的变更操作", () => {
  const tools = desktopToolDefinitions();
  const names = tools.map((tool) => tool.name);
  assert.ok(names.includes("check_permissions"));
  assert.ok(names.includes("list_apps"));
  assert.ok(names.includes("get_app_state"));
  assert.ok(names.includes("click"));
  assert.ok(names.includes("set_value"));
  assert.ok(names.includes("press_key"));

  const readOnly = (name) => tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint;
  assert.equal(readOnly("check_permissions"), true);
  assert.equal(readOnly("list_apps"), true);
  assert.equal(readOnly("get_app_state"), true);
  assert.equal(readOnly("click"), false);

  const click = tools.find((tool) => tool.name === "click");
  assert.deepEqual(click.inputSchema.required, ["app", "window_id", "window_title"]);
  const clickProperties = click.inputSchema.properties;
  assert.ok(clickProperties.x && clickProperties.y && clickProperties.element_index);

  const state = tools.find((tool) => tool.name === "get_app_state");
  assert.deepEqual(state.inputSchema.required, ["app"]);
  assert.deepEqual(state.inputSchema.properties.window_id.type, "string");
});

test("解析 PNG 文件头得到截图像素尺寸", () => {
  assert.deepEqual(parsePngDimensions(pngHeader(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(parsePngDimensions(pngHeader(200, 100)), { width: 200, height: 100 });
  assert.equal(parsePngDimensions(Buffer.alloc(10)), null);
  assert.equal(parsePngDimensions(Buffer.from("not a png header at all!")), null);
});

test("打包后把 JXA 助手解析到 app.asar.unpacked 路径", () => {
  const packed = "/Applications/DYWorker.app/Contents/Resources/app.asar/electron/scripts/macos_computer_use.js";
  assert.equal(
    unpackedResourcePath(packed),
    "/Applications/DYWorker.app/Contents/Resources/app.asar.unpacked/electron/scripts/macos_computer_use.js",
  );
  assert.equal(
    unpackedResourcePath("C:\\DYWorker\\resources\\app.asar\\electron\\scripts\\macos_computer_use.js"),
    "C:\\DYWorker\\resources\\app.asar.unpacked\\electron\\scripts\\macos_computer_use.js",
  );
  assert.equal(unpackedResourcePath("/tmp/plain/path.js"), "/tmp/plain/path.js");
});

test("JXA 助手文件存在且包含系统接口调用", async () => {
  const helper = fileURLToPath(new URL("../electron/scripts/macos_computer_use.js", import.meta.url));
  const content = await fs.readFile(helper, "utf8");
  assert.match(content, /AXIsProcessTrusted/);
  assert.match(content, /CGEventCreateMouseEvent/);
  assert.match(content, /DYWORKER_CU_PAYLOAD/);
  assert.ok(path.basename(helper) === "macos_computer_use.js");
});

const e2e = process.platform === "darwin" && process.env.DYWORKER_CU_E2E === "1";
test("macOS 真实图形会话：内置服务完成握手、权限检查、列应用与读取界面", { skip: !e2e }, async () => {
  const serverPath = fileURLToPath(new URL("../electron/macos-computer-use-server.mjs", import.meta.url));
  const client = new McpClient({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env },
    requestTimeoutMs: 60_000,
  });
  try {
    await client.connect();
    const names = client.tools.map((tool) => tool.name);
    assert.ok(names.includes("check_permissions"));

    const permissions = await client.callTool("check_permissions", {});
    assert.match(permissions.text, /辅助功能权限/);

    const apps = await client.callTool("list_apps", {});
    assert.ok(apps.text.trim().length > 0);

    const state = await client.callTool("get_app_state", { app: "com.apple.finder" });
    assert.match(state.text, /窗口编号：\d+/);
    assert.ok(state.images.length > 0, "应返回窗口截图");
  } finally {
    await client.close().catch(() => {});
  }
});
