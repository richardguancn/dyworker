import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMPUTER_USE_TOOL_PREFIX, computerUseAction } from "../computer-use.mts";
import { McpClient } from "../mcp.mts";
import { validateDesktopClick } from "./click-parameters.mts";

const nativeActions = new Set([
  "click", "drag", "perform_secondary_action", "press_key", "scroll", "select_text", "set_value", "type_text",
]);
const checkPermissions = "check_permissions";
const sharedObservation = "get_shared_app_state";
const observationProperty = {
  type: "string",
  description: "最近一次 get_app_state 返回的观察编号。每次操作后重新读取。",
};
const isPid = (value: string) => /^[1-9][0-9]{0,9}$/.test(value);
const failure = (result: string) => ({ ok: false, result });
const pidOf = (text: string) => /^App=.* \(pid (\d+)\)\s*$/m.exec(text.split("\n")[0])?.[1];

function modelTool(tool, platform: string) {
  const schema = tool.inputSchema || {};
  const { $schema, ...input } = schema;
  const {
    window_placement, click_method, key_method, ...nativeProperties
  } = input.properties || {};
  const properties = { ...nativeProperties };
  const action = nativeActions.has(tool.name);
  if ("app" in properties) properties.app = { type: "string", description: platform === "darwin"
    ? "list_apps 返回的正在运行的应用标识，如 com.apple.TextEdit。"
    : "list_apps 返回的目标应用的进程号 PID，使用数字字符串。" };
  if (action) properties.observation_id = observationProperty;
  if (action && platform === "linux") {
    properties.background = {
      type: "boolean",
      description: "默认后台控件操作。只有用户明确允许使用当前桌面和键鼠时才可传 false。",
    };
  }
  const required = [...(input.required || []), ...(action ? ["observation_id"] : [])];
  delete input.required;
  return {
    type: "function",
    function: {
      name: `${COMPUTER_USE_TOOL_PREFIX}${tool.name}`,
      description: `【本机应用操作】${tool.description || tool.name}${action ? " 动作后重新读取界面并确认结果。" : ""}`,
      parameters: { ...input, type: "object", properties, ...(required.length ? { required } : {}) },
    },
  };
}

export function createComputerUseRuntime(
  server: ReturnType<typeof import("../computer-use.mts").discoverComputerUseServer>,
  newClient = (options: object) => new McpClient(options),
) {
  type Run = {
    client: McpClient, connected: Promise<void>, closed: boolean,
    observation?: { id: string, args: Record<string, any>, result: Awaited<ReturnType<McpClient["callTool"]>> },
    closing?: Promise<void>,
  };
  const runs = new Map<string, Run>();
  let catalog: Promise<any[]> | undefined;
  // All tasks use one physical desktop, even when their observations are separate.
  let desktopQueue = Promise.resolve();
  let disposed = false;
  const keyOf = (sessionId: string, runId: string) => JSON.stringify([sessionId, runId]);

  function definitions() {
    if (!server || disposed) return Promise.resolve([]);
    catalog ??= (async () => {
      const probe = newClient(server);
      try {
        await probe.connect();
        const tools = probe.tools.filter(tool => ["list_apps", "get_app_state"].includes(tool.name) || nativeActions.has(tool.name));
        if (server.platform === "linux") {
          const observation = tools.find(tool => tool.name === "get_app_state");
          if (observation) tools.push({ ...observation, name: sharedObservation,
            description: "截取 Linux 当前桌面上目标窗口所在区域，可能含有遮住它的其他窗口。仅在用户明确允许使用当前桌面且确认目标窗口可见时使用。" });
        }
        if (server.platform === "darwin") tools.push({
          name: checkPermissions,
          description: "只查询 Open Computer Use 的 macOS 辅助功能与屏幕录制权限。",
          inputSchema: { type: "object", properties: {} },
        });
        return tools.map(tool => modelTool(tool, server.platform));
      } finally {
        await probe.close();
      }
    })().catch(error => {
      catalog = undefined;
      console.warn(`[computer-use] 无法读取本机操作工具：${error.message}`);
      return [];
    });
    return catalog;
  }

  async function closeRun(run: Run) {
    run.closed = true;
    run.closing ??= run.client.close();
    await run.closing;
  }

  async function stopRun(sessionId: string, runId: string) {
    const key = keyOf(sessionId, runId);
    const run = runs.get(key);
    if (!run) return;
    await closeRun(run);
    if (runs.get(key) === run) runs.delete(key);
  }

  async function stopAll() {
    disposed = true;
    await Promise.all([...runs.values()].map(closeRun));
    runs.clear();
  }

  async function call(fullName: string, args: Record<string, any> = {}, {
    sessionId = "", runId = "", signal, review = false,
  }: { sessionId?: string, runId?: string, signal?: AbortSignal, review?: boolean } = {}) {
    const name = computerUseAction(fullName);
    if (!server || disposed) return failure("当前系统没有可用的本机应用操作程序。");
    if (!sessionId || !runId || signal?.aborted) return failure("本机操作需要有效的任务。");
    const available = await definitions();
    const toolDefinition = available.find(tool => tool.function.name === fullName)?.function;
    if (!toolDefinition) return failure("当前平台未提供这项本机操作。");
    if (signal?.aborted || disposed) return failure("任务已停止。");

    if (name === checkPermissions) {
      try {
        const { stdout } = await promisify(execFile)(server.command, ["doctor", "--json"], { env: server.env, timeout: 5000, signal });
        const state = JSON.parse(stdout);
        const result = state.allGranted ? "已取得辅助功能和屏幕录制权限。"
          : "请在「系统设置 → 隐私与安全性」中为 Open Computer Use 开启辅助功能和屏幕录制，再重试。";
        return { ok: true, result };
      } catch (error: any) { return failure(`检查权限失败：${error.message}`); }
    }

    const key = keyOf(sessionId, runId);
    let run = runs.get(key);
    if (!run) {
      const client = newClient(server);
      run = { client, connected: client.connect(), closed: false };
      void run.connected.catch(() => {});
      runs.set(key, run);
    }
    const current = run;
    const onAbort = () => {
      void closeRun(current).then(() => {
        if (runs.get(key) === current) runs.delete(key);
      }, error => console.warn("[computer-use] 停止失败", error));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const operation = desktopQueue.then(async () => {
      if (current.closed || signal?.aborted || disposed) return failure("任务已停止。");
      await current.connected;
      if (current.closed || signal?.aborted || disposed) return failure("任务已停止。");
      const invoke = (tool: string, input: object) => {
        signal?.throwIfAborted();
        if (current.closed) throw new Error("任务已停止。");
        return current.client.callTool(tool, input, { signal });
      };
      const format = (result: Awaited<ReturnType<McpClient["callTool"]>>) =>
        ({ ok: !result.isError, result: result.text, images: result.images });
      if (name === "list_apps") return format(await invoke(name, {}));
      const app = String(args.app || "");
      const isMac = server.platform === "darwin";
      if (!(isMac ? /^[a-z0-9][a-z0-9.-]+\.[a-z0-9-]+$/i.test(app) : isPid(app))) {
        return failure("请先列出应用，并使用目标应用的标识或正在运行的 PID。");
      }

      const previous = current.observation;
      if (review) {
        if (previous?.id !== args.observation_id || previous?.args.app !== app) return failure("当前观察已失效，请重新读取目标窗口。");
        const fresh = await invoke("get_app_state", previous.args);
        if (fresh.isError) return format(fresh);
        if (fresh.text !== previous.result.text) return failure("目标窗口或控件已发生变化，请重新观察。");
        return format(fresh);
      }
      if (name === "get_app_state" || name === sharedObservation) {
        current.observation = undefined;
        if (isMac) {
          const catalog = await invoke("list_apps", {});
          if (catalog.isError) return format(catalog);
          const running = catalog.text.split("\n").some(line => {
            const match = / — (\S+) \[([^\]]*)\]$/.exec(line);
            return match?.[1] === app && match[2].split(", ").includes("running");
          });
          if (!running) return failure("请先打开目标应用，再读取界面。");
        }
        const observationArgs = {
          app, text_limit: args.text_limit, max_tree_nodes: args.max_tree_nodes, max_tree_depth: args.max_tree_depth,
          include_ax: args.include_ax !== false,
          include_screenshot: server.platform === "linux" ? name === sharedObservation : args.include_screenshot !== false,
        };
        const result = await invoke("get_app_state", observationArgs);
        if (result.isError) return format(result);
        const pid = pidOf(result.text);
        if (!pid || (isMac ? !result.text.startsWith(`App=${app} (pid `) : pid !== app)) {
          return failure("返回的窗口无法与目标应用核对，请重新列出应用。");
        }
        const id = randomUUID();
        current.observation = { id, args: observationArgs, result };
        return { ...format(result), result: `观察编号：${id}\n${result.text}` };
      }

      if (!previous || previous.id !== args.observation_id || previous.args.app !== app) {
        return failure("当前观察已失效，请先读取目标窗口并携带最新观察编号。");
      }
      const nativeArgs = Object.fromEntries(Object.entries(args).filter(([field]) =>
        Object.hasOwn(toolDefinition.parameters.properties, field)
        && field !== "background" && field !== "observation_id"));
      if (name === "click") {
        try { validateDesktopClick(args); }
        catch (error: any) { return failure(error.message); }
      }
      const hasElement = typeof args.element_index === "string" && /^\d+$/.test(args.element_index);
      const shared = args.background === false;
      const coordinate = name === "drag" || (name === "click" && !hasElement);
      if (coordinate && !previous.result.images.length) return failure("坐标操作需要最新的窗口截图。");
      if (coordinate) {
        const points = name === "drag" ? [[args.from_x, args.from_y], [args.to_x, args.to_y]] : [[args.x, args.y]];
        // Both Linux and Windows return PNG. The signed Mac runtime checks its own image bounds.
        const png = previous.result.images[0].mimeType === "image/png" ? Buffer.from(previous.result.images[0].data, "base64") : undefined;
        const width = png?.length >= 24 ? png.readUInt32BE(16) : Infinity;
        const height = png?.length >= 24 ? png.readUInt32BE(20) : Infinity;
        if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height)) {
          return failure("操作坐标超出本次窗口截图。");
        }
      }
      if (server.platform === "linux") {
        const simpleClick = name === "click" && hasElement && (args.mouse_button ?? "left") === "left" && (args.click_count ?? 1) === 1;
        if (!shared && !simpleClick && name !== "set_value") {
          return failure("此操作可能使用当前桌面的鼠标或键盘，须经用户明确同意后使用 background=false。");
        }
        if (simpleClick) nativeArgs.click_method = "accessibility";
        if (shared && !previous.args.include_screenshot && coordinate) return failure("请先确认当前桌面的截图范围。");
      }
      if (server.platform === "darwin") {
        if (name === "click" && !hasElement && (args.mouse_button ?? "left") === "left") nativeArgs.click_method = "sky_click";
        if (name === "press_key" || name === "type_text") nativeArgs.key_method = "sky_key";
      }

      // Refresh the same process immediately before dispatch. Never retarget a
      // queued action to the new control occupying an old element index.
      current.observation = undefined;
      const fresh = await invoke("get_app_state", previous.args);
      if (fresh.isError) return format(fresh);
      if (fresh.text !== previous.result.text || (coordinate &&
        fresh.images[0]?.data !== previous.result.images[0]?.data)) {
        return failure("窗口或控件已发生变化。请重新读取界面，再选择操作目标。");
      }
      const result = await invoke(name, nativeArgs);
      return result.isError ? format(result) : { ...format(result), result: `${result.text}\n请重新读取界面，确认操作结果。` };
    }).catch(async (error: any) => {
      await closeRun(current);
      if (runs.get(key) === current && !signal?.aborted) runs.delete(key);
      return failure(signal?.aborted ? "任务已停止。" : `本机操作未获得响应：${error.message}`);
    }).finally(() => signal?.removeEventListener("abort", onAbort));
    desktopQueue = operation.then(() => {}, () => {});
    return operation;
  }

  return { definitions, call, stopRun, stopAll };
}
