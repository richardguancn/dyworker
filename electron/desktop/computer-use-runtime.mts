import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { COMPUTER_USE_TOOL_PREFIX, computerUseAction, computerUseKeyReceipt } from "../computer-use.mts";
import { McpClient } from "../mcp.mts";
import { notepadApp, notepadReplace, planNotepadReplace, replaceNotepadText } from "./notepad-replace.mts";
import { validateDesktopClick } from "./click-parameters.mts";
import { isNavigationClick, macControlEvidence, macObservationText, navigationObservation } from "./macos-observation.mts";
import { createLinuxOcclusionChecker, verifyLinuxTargetRegion, type OcclusionVerdict } from "./linux-screen-check.mts";
import { browserFillForm, browserFillReview, browserFormFields, browserFormHint, browserFormObservation, browserFormSave,
  browserFormUnavailable, browserFormWindow, browserInputUnverified, browserTextShortcut, fillBrowserForm, hasBrowserPage,
  isBrowserFormField, matchBrowserFormSave, planBrowserFill, readBrowserForm, verifiedBrowserChromeFocus } from "./browser-fill-form.mts";

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

const toolDescriptions: Record<string, string> = {
  list_apps: "列出可操作应用（运行中优先）及 ID/PID。",
  get_app_state: "读取目标窗口的控件树（非 Linux 含截图）并生成观察编号。",
  click: "点击目标控件（element_index）或坐标（x, y）。",
  drag: "按起始与结束坐标拖拽。",
  scroll: "滚动目标界面（可指定坐标与 delta_x/delta_y）。",
  press_key: "发送按键或组合键。",
  type_text: "输入文字到当前焦点或指定位置。",
  set_value: "设置可编辑控件的字符串值。",
  select_text: "按偏移选中可编辑控件中的文字。",
  perform_secondary_action: "触发控件的次要辅助功能动作。",
};
const paramDescriptions: Record<string, string> = {
  element_index: "最新观察中的数字控件编号。",
  x: "相对窗口左上角的横向像素坐标。",
  y: "相对窗口左上角的纵向像素坐标。",
  from_x: "拖拽起点横向坐标。",
  from_y: "拖拽起点纵向坐标。",
  to_x: "拖拽终点横向坐标。",
  to_y: "拖拽终点纵向坐标。",
  mouse_button: "鼠标按键：left、right 或 middle。",
  click_count: "点击次数，默认 1。",
  key: "按键或组合键名（如 Return、cmd+a、Tab）。",
  text: "要输入的文字内容。",
  value: "要写入的新字符串值。",
  delta_x: "水平滚动距离。",
  delta_y: "垂直滚动距离。",
  max_tree_nodes: "控件树最大节点数（默认 1200）。",
  max_tree_depth: "控件树最大深度（默认 64）。",
  include_ax: "是否采集无障碍控件树，默认 true。",
  include_screenshot: "是否截取窗口图像，默认 true。",
  start_offset: "选区起始字符偏移。",
  end_offset: "选区结束字符偏移。",
  action: "要执行的次要动作名。",
};

function formatListApps(text: string) {
  const lines = text.split("\n");
  const entry = / — \S+ \[([^\]]*)\]$/;
  const running = lines.filter(line => {
    const match = entry.exec(line);
    return match && match[1].split(", ").includes("running");
  });
  if (!running.length) return text;
  const filtered = lines.filter(line => !entry.test(line) || running.includes(line));
  return filtered.length < lines.length
    ? `${filtered.join("\n")}\n（仅显示当前正在运行的应用。）`
    : text;
}

function formatObservationForModel(text: string, { hasImages = false, linuxNoControls = false } = {}) {
  const cleaned = text
    .split("\n")
    .map(line => {
      let next = line.replace(/(?:, )?Secondary Actions: Raise(?=,|$)/g, "");
      if (line.startsWith("\t")) next = next.replace(/, ID: [A-Za-z0-9_?&=.-]{16,}(?=,|$)/g, "");
      return next.replace(/,\s*$/, "");
    })
    .join("\n")
    .replace(hasImages ? /\n?（同时获取到 \d+ 张界面截图。）(?=\n|$)/g : /$^/, "");
  return linuxNoControls
    ? `${cleaned}\n提示：当前窗口未暴露内部无障碍控件，请改用 get_shared_app_state 获取当前桌面窗口截图后再操作。`
    : cleaned;
}

const isBareLinuxWindow = (text: string) =>
  /^0 (?:frame|window|dialog)\b/m.test(text) && !/^\t+\d+ /m.test(text);

function modelTool(tool, platform: string) {
  const schema = tool.inputSchema || {};
  const { $schema, ...input } = schema;
  const {
    window_placement, click_method, key_method, ...nativeProperties
  } = input.properties || {};
  if (platform === "linux" && (tool.name === "get_app_state" || tool.name === sharedObservation)) {
    delete nativeProperties.include_screenshot;
  }
  const properties: Record<string, any> = {};
  for (const [field, prop] of Object.entries(nativeProperties)) {
    const compact = paramDescriptions[field];
    properties[field] = compact && prop && typeof prop === "object"
      ? { ...prop, description: compact }
      : prop;
  }
  if ("text_limit" in properties && (tool.name === "get_app_state" || tool.name === sharedObservation)) {
    properties.text_limit = {
      ...properties.text_limit,
      description: "通常省略，使用默认文字长度。只有要读取较长正文时才传正整数或 max。",
    };
  }
  const action = nativeActions.has(tool.name) || tool.name === notepadReplace || tool.name === browserFillForm;
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
  const guidance = platform === "darwin" && ["click", "set_value", "press_key", "type_text"].includes(tool.name)
    ? " macOS 网页表单优先使用 fill_form，把本页待改字段一次传入。" : "";
  if (action && platform === "linux") {
    properties.background = {
      type: "boolean",
      description: "默认后台控件操作。需要操作共享桌面键鼠或坐标时传 false。",
    };
  }
  const required = [...(input.required || []), ...(action ? ["observation_id"] : [])];
  delete input.required;
  const summaryDesc = toolDescriptions[tool.name] || tool.description || tool.name;
  return {
    type: "function",
    function: {
      name: `${COMPUTER_USE_TOOL_PREFIX}${tool.name}`,
      description: `【本机应用操作】${summaryDesc}${action && tool.name !== browserFillForm ? " 动作后重新读取界面并确认结果。" : ""}${guidance}`,
      parameters: { ...input, type: "object", properties, ...(required.length ? { required } : {}) },
    },
  };
}

type ReviewedAction = Parameters<typeof macControlEvidence>[1];

const defaultNewClient = (options: object) => new McpClient(options);

export function createComputerUseRuntime(
  server: ReturnType<typeof import("../computer-use.mts").discoverComputerUseServer>,
  newClient = defaultNewClient,
  deps: {
    inspectOcclusion?: (input: { pid: number, points: [number, number][], imageSize?: { width: number, height: number } }) => Promise<OcclusionVerdict>,
    isScreenLocked?: () => boolean,
  } = {},
) {
  const inspectOcclusion = deps.inspectOcclusion ?? (
    newClient === defaultNewClient && server?.platform === "linux" && process.platform === "linux"
      ? createLinuxOcclusionChecker()
      : undefined
  );
  const isScreenLocked = typeof deps.isScreenLocked === "function" ? deps.isScreenLocked : () => false;
  type Run = {
    client: McpClient, connected: Promise<void>, closed: boolean,
    observation?: { id: string, args: Record<string, any>, controlsOnly: boolean, browserWindow?: string,
      result: Pick<Awaited<ReturnType<McpClient["callTool"]>>, "text" | "images">,
      filled?: { snapshot: Awaited<ReturnType<typeof readBrowserForm>>, labels: string[] } },
    observedBrowsers: Set<string>,
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
        if (server.platform === "darwin" && ["get_app_state", "click", "set_value", "press_key", "type_text"]
          .every(name => tools.some(tool => tool.name === name)) && probe.tools.some(tool => tool.name === "query")) {
          tools.push({
            name: browserFillForm,
            description: "在 macOS 浏览器已打开的网页中一次替换一个或多个文字输入框。先读取并确认页面及输入框编号。工具逐项替换并读回，遇到变化即停止。保存或提交须另行操作。",
            inputSchema: { type: "object", properties: {
              app: { type: "string" },
              fields: browserFormFields,
            }, required: ["app", "fields"] },
          });
        }
        const definitions = tools.map(tool => modelTool(tool, server.platform));
        if (tools.some(tool => tool.name === browserFillForm)) {
          const state = definitions.find(tool => tool.function.name === COMPUTER_USE_TOOL_PREFIX + "get_app_state");
          state.function.parameters.properties.form_only = {
            type: "boolean",
            description: "网页填表时设为 true。返回当前网页、表单范围和可填写的文字输入框编号，省略截图与正文。随后用 fill_form。",
          };
        }
        return definitions;
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
    sessionId = "", runId = "", signal, review = false, reviewAction, interfaceImagesSupported = true,
  }: { sessionId?: string, runId?: string, signal?: AbortSignal, review?: boolean, reviewAction?: ReviewedAction, interfaceImagesSupported?: boolean } = {}) {
    const name = computerUseAction(fullName);
    const visionEnabled = interfaceImagesSupported !== false;
    if (!server || disposed) return failure("当前系统没有可用的本机应用操作程序。");
    if (!sessionId || !runId || signal?.aborted) return failure("本机操作需要有效的任务。");
    const available = await definitions();
    const toolDefinition = available.find(tool => tool.function.name === fullName)?.function;
    if (!toolDefinition) return failure("当前平台未提供这项本机操作。");
    if (signal?.aborted || disposed) return failure("任务已停止。");
    if (name === sharedObservation && !visionEnabled) {
      return failure("当前模型不支持识别界面图片，无法使用共享桌面截图；请改用带控件树的应用操作或切换支持视觉的模型。");
    }

    if (name === checkPermissions) {
      try {
        const { stdout } = await promisify(execFile)(server.command, ["doctor", "--json"], { env: server.env, timeout: 5000, signal });
        const state = JSON.parse(stdout);
        const result = state.allGranted ? "已取得辅助功能和屏幕录制权限。"
          : "请在「系统设置 → 隐私与安全性」中为 Open Computer Use 开启辅助功能和屏幕录制，再重试。";
        return { ok: true, result };
      } catch (error: any) { return failure(`检查权限失败：${error.message}`); }
    }
    if (isScreenLocked()) {
      return failure("当前电脑屏幕已锁定，原生桌面操作暂不可用。请等待解锁后重试；网页任务可改用 browser__* 工具（支持锁屏期间运行）。");
    }

    const key = keyOf(sessionId, runId);
    let run = runs.get(key);
    if (!run) {
      const client = newClient(server);
      run = { client, connected: client.connect(), closed: false, observedBrowsers: new Set() };
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
      if (name === "list_apps") {
        const listed = await invoke(name, {});
        return listed.isError ? format(listed) : { ...format(listed), result: formatListApps(listed.text) };
      }
      const app = String(args.app || "");
      const isMac = server.platform === "darwin";
      if (!(isMac ? /^[a-z0-9][a-z0-9.-]+\.[a-z0-9-]+$/i.test(app) : isPid(app))) {
        return failure("请先列出应用，并使用目标应用的标识或正在运行的 PID。");
      }

      const previous = current.observation;
      const browserFormAvailable = isMac && available.some(tool => tool.function.name === COMPUTER_USE_TOOL_PREFIX + browserFillForm);
      const formArgs = (input: Record<string, any>) => ({
        ...input, app, include_ax: true, include_screenshot: false, text_limit: "max",
        max_tree_nodes: Math.max(input.max_tree_nodes || 0, 2400),
        max_tree_depth: Math.max(input.max_tree_depth || 0, 96),
      });
      const observeForm = async (input: Record<string, any>) => readBrowserForm(app, await invoke("get_app_state", formArgs(input)), invoke);
      if (name === browserFillForm || (review && reviewAction?.name === browserFillForm)) {
        if (!isMac || !previous?.browserWindow || previous.id !== args.observation_id || previous.args.app !== app || previous.controlsOnly) {
          return failure("请先读取浏览器中的目标网页，并携带这次观察编号。");
        }
        const observe = () => observeForm(previous.args);
        const latest = await observe();
        if (latest.isError) return failure(latest.text);
        const plan = planBrowserFill(app, previous.result.text, previous.browserWindow, latest, (review ? reviewAction!.args : args).fields);
        if ("error" in plan) return failure(plan.error);
        if (review) return { ok: true, result: browserFillReview(plan), images: [] };
        current.observation = undefined;
        const result = await fillBrowserForm(plan, latest, observe, invoke);
        if (!result.ok || !("snapshot" in result) || !result.snapshot.form) return failure(result.result);
        const id = randomUUID();
        const snapshot = result.snapshot;
        current.observation = { id, args: formArgs(previous.args), controlsOnly: false,
          browserWindow: snapshot.form.windowKey, result: { text: snapshot.text, images: [] },
          filled: { snapshot, labels: result.verified } };
        const saves = snapshot.form.saves;
        const next = saves.length === 1
          ? `${saves[0].index} 按钮「${saves[0].label}」${saves[0].disabled ? "（不可用）" : "（可用）"}`
          : "当前未识别到唯一的「保存」按钮。";
        return { ok: true, result: `${result.result}\n观察编号：${id}\n${next}\n如需保存，使用此观察和按钮单独点击；不必再读取字段正文。`, images: [] };
      }
      const clickArgs = review && reviewAction?.name === "click" ? reviewAction.args : name === "click" ? args : undefined;
      const filled = previous?.filled;
      const save = filled && clickArgs && previous.id === args.observation_id && previous.args.app === app
        && clickArgs.x === undefined && clickArgs.y === undefined
        && (clickArgs.mouse_button ?? "left") === "left" && (clickArgs.click_count ?? 1) === 1
        && browserFormSave(filled.snapshot, clickArgs.element_index);
      if (save) {
        const fresh = await observeForm(previous.args);
        const target = matchBrowserFormSave(filled.snapshot, fresh, save, filled.labels);
        if (!target || target.disabled) return failure("当前表单、字段或保存按钮已变化，请重新核对。");
        if (review) return { ok: true, result: browserFormObservation(fresh), images: [] };
        current.observation = undefined;
        const action = await invoke("click", { app, element_index: target.index, click_method: "accessibility" });
        if (action.isError) return failure("保存操作未获确认，请读取当前表单状态。");
        for (const wait of [0, 180, 360, 700]) {
          if (wait) await delay(wait, undefined, { signal });
          const after = await observeForm(previous.args);
          const button = matchBrowserFormSave(filled.snapshot, after, save, filled.labels);
          if (after.form && !button) break;
          if (button?.disabled) {
            const id = randomUUID();
            current.observation = { id, args: formArgs(previous.args), controlsOnly: false,
              browserWindow: after.form.windowKey, result: { text: after.text, images: [] } };
            return { ok: true, result: `已点击「${save.label}」，页面上的保存按钮已变为不可用，已填写字段读回一致。\n观察编号：${id}\n${browserFormObservation(after)}`, images: [] };
          }
        }
        return { ok: true, result: `已点击「${save.label}」，尚未核对保存结果。请先读取当前表单状态，避免再次点击保存。`, images: [] };
      }
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
      const pointsOf = (actionName: string, actionArgs: Record<string, any>): [number, number][] | undefined => {
        if (actionName === "drag") return [[actionArgs.from_x, actionArgs.from_y], [actionArgs.to_x, actionArgs.to_y]];
        const hasIdx = typeof actionArgs.element_index === "string" && /^\d+$/.test(actionArgs.element_index);
        if (actionName === "click" && !hasIdx) return [[actionArgs.x, actionArgs.y]];
      };
      const verifyCoordinateState = async (
        fresh: Awaited<ReturnType<McpClient["callTool"]>>,
        points: [number, number][],
      ): Promise<string | undefined> => {
        if (!visionEnabled) {
          return "当前模型不支持识别界面截图，禁止按屏幕坐标点击或拖拽。请改用控件编号操作，或切换支持视觉的模型。";
        }
        if (server.platform === "linux") {
          const region = verifyLinuxTargetRegion({
            previousImage: previous!.result.images[0],
            freshImage: fresh.images[0],
            points,
          });
          if (!region.ok) return "reason" in region ? region.reason : "目标区域画面已发生变化，请重新读取界面。";
          if (inspectOcclusion) {
            const verdict = await inspectOcclusion({ pid: Number(app), points, imageSize: region.imageSize });
            if (verdict.status === "occluded") {
              const who = verdict.isSelf ? "（DYWorker 主窗口）" : verdict.occluderTitle ? `「${verdict.occluderTitle}」` : "";
              return `目标位置 (${Math.round(verdict.point[0])}, ${Math.round(verdict.point[1])}) 当前被上层窗口${who}遮挡。请将目标窗口置于前台并移开遮挡后再重新读取界面。`;
            }
            if (verdict.status === "unknown") {
              return `无法确认目标位置未被其他窗口遮挡（${verdict.reason}），请确认目标窗口在前台可见后重新读取界面。`;
            }
          }
          return undefined;
        }
        if (fresh.images[0]?.data !== previous!.result.images[0]?.data) {
          return "窗口或控件已发生变化。请重新读取界面，再选择操作目标。";
        }
        return undefined;
      };
      if (review) {
        if (previous?.id !== args.observation_id || previous?.args.app !== app) return failure("当前观察已失效，请重新读取目标窗口。");
        const reviewPoints = reviewAction ? pointsOf(reviewAction.name, reviewAction.args) : undefined;
        const evidence = isMac && !reviewPoints && reviewAction ? macControlEvidence(previous.result.text, reviewAction) : undefined;
        const fresh = await invoke("get_app_state", evidence ? { ...previous.args, include_screenshot: false } : previous.args);
        if (fresh.isError) return format(fresh);
        const matches = evidence ? macControlEvidence(fresh.text, reviewAction!) === evidence : fresh.text === previous.result.text;
        if (!matches) return failure("目标窗口或控件已发生变化，请重新观察。");
        if (reviewPoints) {
          const coordError = await verifyCoordinateState(fresh, reviewPoints);
          if (coordError) return failure(coordError);
        }
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
        const formOnly = browserFormAvailable && args.form_only === true;
        const controlsOnly = isMac && !formOnly && args.controls_only === true;
        const textLimit = typeof args.text_limit === "string" && /^\d+$/.test(args.text_limit)
          ? Number(args.text_limit) : args.text_limit;
        const observationArgs = {
          app, text_limit: formOnly ? "max" : textLimit,
          max_tree_nodes: formOnly ? 2400 : args.max_tree_nodes, max_tree_depth: formOnly ? 96 : args.max_tree_depth,
          include_ax: formOnly || controlsOnly || args.include_ax !== false,
          include_screenshot: !visionEnabled
            ? false
            : (server.platform === "linux" ? name === sharedObservation : !formOnly && !controlsOnly && args.include_screenshot !== false),
        };
        let result = await invoke("get_app_state", observationArgs);
        let form = formOnly ? await readBrowserForm(app, result, invoke) : undefined;
        let summary = form && browserFormObservation(form);
        if (formOnly) {
          for (const wait of [160, 360, 700]) {
            if (summary || result.isError) break;
            await delay(wait, undefined, { signal });
            result = await invoke("get_app_state", observationArgs);
            form = await readBrowserForm(app, result, invoke);
            summary = browserFormObservation(form);
          }
        }
        if (result.isError) return format(result);
        const pid = pidOf(result.text);
        if (!pid || (isMac ? !result.text.startsWith(`App=${app} (pid `) : pid !== app)) {
          return failure("返回的窗口无法与目标应用核对，请重新列出应用。");
        }
        const id = randomUUID();
        if (formOnly && !summary) {
          const visibleFallback = formatObservationForModel(result.text, { hasImages: false });
          current.observation = { id, args: observationArgs, controlsOnly: false, browserWindow: undefined, result };
          if (hasBrowserPage(result.text)) current.observedBrowsers.add(app);
          return {
            ...format(result),
            ok: true,
            result: `观察编号：${id}\n${browserFormUnavailable}\n以下为当前窗口的最新界面内容：\n${visibleFallback}`,
            images: [],
          };
        }
        const browserWindow = form ? form.form?.windowKey : browserFormAvailable && !controlsOnly
          ? await browserFormWindow(app, result.text, invoke) : undefined;
        current.observation = { id, args: observationArgs, controlsOnly, browserWindow, result };
        const hasImages = visionEnabled && !controlsOnly && !formOnly && result.images.length > 0;
        const bareLinux = server.platform === "linux" && name === "get_app_state" && isBareLinuxWindow(result.text);
        const visible = summary || (controlsOnly
          ? navigationObservation(result.text)
          : formatObservationForModel(result.text, { hasImages, linuxNoControls: bareLinux && visionEnabled }));
        const noVisionLinuxNote = bareLinux && !visionEnabled
          ? "\n注意：当前模型不支持图片输入，且该窗口未暴露内部无障碍控件；请切换支持视觉的模型后重试。"
          : "";
        if (browserFormAvailable && hasBrowserPage(result.text)) current.observedBrowsers.add(app);
        const hint = !controlsOnly && !summary && current.observedBrowsers.has(app) ? `${browserFormHint}\n` : "";
        return {
          ...format(result),
          result: `观察编号：${id}\n${hint}${visible}${noVisionLinuxNote}`,
          images: controlsOnly || formOnly || !visionEnabled ? [] : result.images,
        };
      }

      if (!previous || previous.id !== args.observation_id || previous.args.app !== app) {
        return failure("当前观察已失效，请先读取目标窗口并携带最新观察编号。");
      }
      const protectBrowserInput = browserFormAvailable && browserTextShortcut(name, args);
      if (browserFormAvailable && name === "set_value" && isBrowserFormField(app, previous.result.text, args.element_index)) {
        return failure(browserFormHint);
      }
      if (protectBrowserInput && current.observedBrowsers.has(app) && !verifiedBrowserChromeFocus(previous.result.text)) {
        return failure(browserInputUnverified);
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
      if (coordinate && !visionEnabled) {
        return failure("当前模型不支持识别界面截图，禁止按屏幕坐标点击或拖拽。请改用控件编号操作，或切换支持视觉的模型。");
      }
      if (coordinate && !previous.result.images.length) return failure("坐标操作需要最新的窗口截图。");
      if (coordinate) {
        const points = pointsOf(name, args)!;
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
        if (shared && !previous.args.include_screenshot && coordinate) return failure("请先使用 get_shared_app_state 截取当前窗口并确认坐标目标。");
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
      // Coordinate actions still check target patch pixels and Linux X11 window stacking occlusion.
      const evidence = isMac && !coordinate ? macControlEvidence(previous.result.text, action) : undefined;
      current.observation = undefined;
      const fresh = await invoke("get_app_state", evidence ? { ...previous.args, include_screenshot: false } : previous.args);
      if (fresh.isError) return format(fresh);
      if (protectBrowserInput && (current.observedBrowsers.has(app) || hasBrowserPage(fresh.text)) && !verifiedBrowserChromeFocus(fresh.text)) {
        return failure(browserInputUnverified);
      }
      const matches = evidence ? macControlEvidence(fresh.text, action) === evidence : fresh.text === previous.result.text;
      if (!matches) {
        return failure("窗口或控件已发生变化。请重新读取界面，再选择操作目标。");
      }
      if (coordinate) {
        const coordError = await verifyCoordinateState(fresh, pointsOf(name, args)!);
        if (coordError) return failure(coordError);
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
