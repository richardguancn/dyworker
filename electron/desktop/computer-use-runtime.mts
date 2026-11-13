import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { COMPUTER_USE_TOOL_PREFIX, computerUseAction, computerUseKeyReceipt } from "../computer-use.mts";
import { McpClient } from "../mcp.mts";
import { notepadApp, notepadReplace, planNotepadReplace, replaceNotepadText } from "./notepad-replace.mts";
import { validateDesktopClick } from "./click-parameters.mts";
import { isNavigationClick, macControlEvidence, macObservationText, navigationObservation } from "./macos-observation.mts";

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
  if ("text_limit" in properties && (tool.name === "get_app_state" || tool.name === sharedObservation)) {
    properties.text_limit = {
      ...properties.text_limit,
      description: "通常省略，使用默认文字长度。只有要读取较长正文时才传正整数或 max。",
    };
  }
  const action = nativeActions.has(tool.name) || tool.name === notepadReplace;
  if ("app" in properties && tool.name !== notepadReplace) properties.app = { type: "string", description: platform === "darwin"
    ? "list_apps 返回的正在运行的应用标识，如 com.apple.TextEdit。"
    : "list_apps 返回的目标应用的进程号 PID，使用数字字符串。" };
  if (action) properties.observation_id = observationProperty;
  if (platform === "darwin" && tool.name === "get_app_state") {
    properties.controls_only = {
      type: "boolean",
      description: "定位标签页时设为 true，仅返回窗口和导航控件，省略正文、选区和截图。确认目标后重新读取正文。",
    };
  }
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

type ReviewedAction = Parameters<typeof macControlEvidence>[1];

export function createComputerUseRuntime(
  server: ReturnType<typeof import("../computer-use.mts").discoverComputerUseServer>,
  newClient = (options: object) => new McpClient(options),
) {
  type Run = {
    client: McpClient, connected: Promise<void>, closed: boolean,
    observation?: { id: string, args: Record<string, any>, controlsOnly: boolean, result: Awaited<ReturnType<McpClient["callTool"]>> },
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
          name: notepadReplace,
          description: "Notepad-- 当前文档的文字替换首选。确认正文后一次提交，通过应用的普通查找/替换只改唯一匹配并复读。参数 old_text 只传要替换的文字，保留周围引号等原文。不会保存文件，也不使用系统鼠标、键盘或剪贴板。",
          inputSchema: { type: "object", properties: {
            app: { type: "string", enum: [notepadApp] },
            old_text: { type: "string", description: "需要精确替换的原文。" },
            new_text: { type: "string", description: "替换后的文字。" },
          }, required: ["app", "old_text", "new_text"] },
        }, {
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
    sessionId = "", runId = "", signal, review = false, reviewAction,
  }: { sessionId?: string, runId?: string, signal?: AbortSignal, review?: boolean, reviewAction?: ReviewedAction } = {}) {
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
      if (name === notepadReplace || (review && reviewAction?.name === notepadReplace)) {
        if (!isMac || app !== notepadApp) return failure("此替换入口用于 macOS 的 Notepad--。");
        if (!previous || previous.id !== args.observation_id || previous.args.app !== app || previous.controlsOnly) {
          return failure("请先读取 Notepad-- 的目标正文，并携带这次观察编号。");
        }
        const observe = () => invoke("get_app_state", { ...previous.args, include_ax: true, include_screenshot: false, text_limit: "max" });
        const latest = await observe();
        if (latest.isError) return format(latest);
        const plan = planNotepadReplace(previous.result.text, latest.text, review ? reviewAction!.args : args);
        if ("error" in plan) return failure(plan.error);
        if (review) return {
          ok: true,
          result: `${plan.document.window}\n已核对正文，目标文字唯一匹配。拟将「${plan.oldText}」替换为「${plan.newText}」，范围仅限当前文档，完成后复读，不保存。`,
          images: [],
        };
        current.observation = undefined;
        const result = await replaceNotepadText(plan, observe, invoke);
        return result.error ? failure(result.error) : { ok: true, result: result.text };
      }
      if (review) {
        if (previous?.id !== args.observation_id || previous?.args.app !== app) return failure("当前观察已失效，请重新读取目标窗口。");
        const evidence = isMac && reviewAction ? macControlEvidence(previous.result.text, reviewAction) : undefined;
        const fresh = await invoke("get_app_state", evidence ? { ...previous.args, include_screenshot: false } : previous.args);
        if (fresh.isError) return format(fresh);
        const matches = evidence ? macControlEvidence(fresh.text, reviewAction!) === evidence : fresh.text === previous.result.text;
        if (!matches) return failure("目标窗口或控件已发生变化，请重新观察。");
        if (previous.controlsOnly) return { ok: true, result: navigationObservation(fresh.text), images: [] };
        return evidence ? { ...format(fresh), images: [] } : format(fresh);
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
        const controlsOnly = isMac && args.controls_only === true;
        const textLimit = typeof args.text_limit === "string" && /^\d+$/.test(args.text_limit)
          ? Number(args.text_limit) : args.text_limit;
        const observationArgs = {
          app, text_limit: textLimit, max_tree_nodes: args.max_tree_nodes, max_tree_depth: args.max_tree_depth,
          include_ax: controlsOnly || args.include_ax !== false,
          include_screenshot: server.platform === "linux" ? name === sharedObservation : !controlsOnly && args.include_screenshot !== false,
        };
        const result = await invoke("get_app_state", observationArgs);
        if (result.isError) return format(result);
        const pid = pidOf(result.text);
        if (!pid || (isMac ? !result.text.startsWith(`App=${app} (pid `) : pid !== app)) {
          return failure("返回的窗口无法与目标应用核对，请重新列出应用。");
        }
        const id = randomUUID();
        current.observation = { id, args: observationArgs, controlsOnly, result };
        const visible = controlsOnly ? navigationObservation(result.text) : result.text;
        return { ...format(result), result: `观察编号：${id}\n${visible}`, images: controlsOnly ? [] : result.images };
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

      const action = { name, args };
      if (previous.controlsOnly) {
        if (!isNavigationClick(previous.result.text, action)) return failure("当前观察仅用于导航，请先重新读取目标界面。");
        nativeArgs.click_method = "accessibility";
      }
      // Preserve the target and relevant UI state at the same native index.
      // Coordinate actions still require the complete matching observation.
      const evidence = isMac && !coordinate ? macControlEvidence(previous.result.text, action) : undefined;
      current.observation = undefined;
      const fresh = await invoke("get_app_state", evidence ? { ...previous.args, include_screenshot: false } : previous.args);
      if (fresh.isError) return format(fresh);
      const matches = evidence ? macControlEvidence(fresh.text, action) === evidence : fresh.text === previous.result.text;
      if (!matches || (coordinate && fresh.images[0]?.data !== previous.result.images[0]?.data)) {
        return failure("窗口或控件已发生变化。请重新读取界面，再选择操作目标。");
      }
      if (evidence && name === "click" && macObservationText(fresh.text) !== macObservationText(previous.result.text)) {
        nativeArgs.click_method = "accessibility";
      }
      const result = await invoke(name, nativeArgs);
      if (isMac && result.isError && /^set_value could not verify/.test(result.text)) {
        return failure(`${result.text} 请先复读。正文没有变化时，优先使用应用自带的「查找/替换」或其他适用的编辑入口；不要重复同一次写入。`);
      }
      if (result.isError) return format(result);
      // Native key actions can return a snapshot without a usable observation ID.
      const receipt = computerUseKeyReceipt(name, result.text);
      return receipt
        ? { ok: true, result: receipt, images: [] }
        : { ...format(result), result: `${result.text}\n请重新读取界面，确认操作结果。` };
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
