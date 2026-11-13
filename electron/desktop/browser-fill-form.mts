import { setTimeout as delay } from "node:timers/promises";
import { macObservationText } from "./macos-observation.mts";

export const browserFillForm = "fill_form";
const maxFields = 20;

export const browserFormFields = {
  type: "array", minItems: 1, maxItems: maxFields,
  description: "当前网页中要整段替换的文字输入框。按顺序填写并核对。",
  items: {
    type: "object", additionalProperties: false, required: ["element_index", "value"],
    properties: {
      element_index: { type: "string", description: "最新观察中的网页输入框编号。" },
      value: { type: "string", description: "完整新值，空字符串清空输入框。" },
    },
  },
};

type NativeResult = { text: string, isError?: boolean };
type Invoke = (name: string, input: Record<string, unknown>) => Promise<NativeResult>;
type Field = { index: string, multiline: boolean, label: string, value: string };
type FormRow = { index: string, multiline: boolean, text: string };
type Form = {
  app: string, window: string, windowKey: string, page: string, document: string, context: string[], tabs: string[],
  rows: FormRow[], focus?: string, selection?: string, incomplete: boolean,
};
type PlannedField = Field & { replacement: string };
type BrowserSnapshot = NativeResult & { form?: Form, fields: Field[] };
type Plan = { form: Form, fields: PlannedField[] };

const nodeLine = /^(\t*)(\d+) (.+)$/;
const webPage = /^(?:HTML内容|HTML 内容|HTML content|web area) (.+), URL: ((?:https?|file):\/\/\S+)$/i;
const input = /^(text entry area|text field|文本输入区|文本栏) \(settable, string\)(?: (.*))?$/i;
const metadata = /, (?:Placeholder|Help|ID|Secondary Actions): /;
const serialized = (value: string) => value.replace(/\n/g, "\\n");
const focusLine = /^The focused UI element is (\d+)(?= |\.|$)/m;

export const browserFormHint = "填写当前网页的文字输入框时，用 fill_form 一次传入本页所有待改字段。可用 get_app_state 的 form_only=true 只读取表单。";

export function hasBrowserPage(text: string) {
  return text.split("\n").some(line => {
    const description = nodeLine.exec(line)?.[3] || "";
    return webPage.test(description) || /^standard window .+ URL: (?:https?|file):\/\//i.test(description)
      || /^标准窗口 .+ URL: (?:https?|file):\/\//.test(description)
      || /^(?:standard window|标准窗口) .+ ID: SafariWindow\?/.test(description);
  });
}

export function browserTextShortcut(name: string, args: Record<string, any>) {
  if (name === "type_text") return true;
  if (name !== "press_key") return false;
  const key = String(args.key || "").toLowerCase().trim();
  return /^(?:(?:cmd|command|meta|super|ctrl|control)\+(?:a|v|x|backspace|delete)|backspace|delete|forwarddelete|space|[\p{L}\p{N}])$/u.test(key);
}

export function isBrowserFormField(app: string, text: string, index: string) {
  return readForm(app, text)?.rows.some(row => row.index === index) === true;
}

export function verifiedBrowserChromeFocus(text: string) {
  const focus = focusLine.exec(text)?.[1];
  if (!focus) return false;
  let pageDepth = -1;
  for (const line of text.split("\n")) {
    const node = nodeLine.exec(line);
    if (!node) continue;
    const depth = node[1].length;
    if (depth <= pageDepth) pageDepth = -1;
    if (webPage.test(node[3])) pageDepth = depth;
    if (node[2] === focus) {
      return pageDepth < 0 && input.test(node[3])
        && /(?:WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD|Address and search bar|Smart Search Field|智能搜索栏|地址和搜索栏|Find in page|在页面中查找)/i
          .test(node[3].split(/\bValue: /, 1)[0]);
    }
  }
  return false;
}

function readForm(appId: string, text: string): Form | undefined {
  const [app, title, window, ...lines] = macObservationText(text).split("\n");
  if (!app.startsWith(`App=${appId} (pid `) || !title?.startsWith('Window: "')
    || !/^0 (?:standard window|标准窗口)(?: |$)/i.test(window || "")) return;
  const root = window.split(", Secondary Actions: ")[0];
  const windowKey = / ID: ([^,]+)$/.exec(root)?.[1] || "";

  const pages: Form[] = [];
  const tabs: string[] = [];
  let document = "";
  let pageDepth = -1;
  let controlDepth = -1;
  for (const line of lines) {
    const node = nodeLine.exec(line);
    if (!node) continue;
    const [, indent, index, description] = node;
    const depth = indent.length;
    if (depth <= pageDepth) pageDepth = -1;
    if (depth <= controlDepth) controlDepth = -1;
    if (pageDepth < 0) {
      if (/^(?:tab|标签)(?: |$)/i.test(description)) tabs.push(description);
      if (/^container ID: BrowserView\?/.test(description)) document = description;
      if (!webPage.test(description)) continue;
      pageDepth = depth;
      pages.push({ app: appId, window: [app, title, root].join("\n"), windowKey, page: description,
        document, context: [], tabs, rows: [], incomplete: /^\[Accessibility tree truncated/im.test(text) });
      continue;
    }
    if (controlDepth >= 0) continue;
    const form = pages.at(-1)!;
    if (/^(?:heading|标题|pop up button|pop-up button|弹出式按钮)(?: |$)/i.test(description)) {
      form.context.push(description.replace(/ \(disabled\)/i, ""));
    }
    const field = input.exec(description);
    if (!field) continue;
    controlDepth = depth;
    form.rows.push({ index, multiline: /^(?:text entry area|文本输入区)$/i.test(field[1]),
      text: (field[2] || "").split(metadata, 1)[0].replace(/^Description: /, "") });
  }
  if (pages.length !== 1) return;
  const [form] = pages;
  form.focus = focusLine.exec(text)?.[1];
  form.selection = /^Selected text: \[([\s\S]*)\](?=\r?\n(?:Screenshot omitted|（同时获取到)|\s*$)/m.exec(text)?.[1];
  return form;
}

function findField(fields: Field[], { label, multiline }: Field) {
  const matches = fields.filter(field => field.label === label);
  return matches.length === 1 && matches[0].multiline === multiline ? matches[0] : undefined;
}

type QueryResult = { window_id?: number, truncated?: boolean, matches?: { title?: string, description?: string, value?: string }[] };
async function queryControls(invoke: Invoke, app: string, role: string, limit: number, windowId?: number) {
  const result = await invoke("query", { app, role, limit, max_nodes: 5000, ...(windowId ? { window_id: windowId } : {}) });
  if (result.isError) return;
  try { return JSON.parse(result.text) as QueryResult; }
  catch { return undefined; }
}

export async function browserFormWindow(app: string, text: string, invoke: Invoke): Promise<string | undefined> {
  const form = readForm(app, text);
  if (!form) return;
  if (form.windowKey) return form.windowKey;
  const result = await queryControls(invoke, app, "AXWebArea", 1);
  if (result?.matches?.length && Number.isInteger(result.window_id) && result.window_id > 0) {
    return String(result.window_id);
  }
}

function readField(row: FormRow, controls?: QueryResult): Field | undefined {
  const parts = /^(?:(.*?) )?Value: (.*)$/.exec(row.text);
  let label = (parts ? parts[1] || "" : row.text).replace(/,$/, "").trim();
  let value = parts?.[2] ?? "";
  // Chromium may concatenate a multiline field's label and value without a separator.
  if (row.multiline && !parts && label) {
    if (!controls || controls.truncated || !Array.isArray(controls.matches)) return;
    const matches = controls.matches.map(control => ({
      label: control.title || control.description || "",
      value: serialized(typeof control.value === "string" ? control.value : ""),
    })).filter(control => control.label && row.text === (control.value ? `${control.label} ${control.value}` : control.label));
    if (matches.length !== 1) return;
    ({ label, value } = matches[0]);
  }
  if (!label || /^(?:Placeholder|Help|ID|Secondary Actions): /.test(label)) return;
  return { index: row.index, multiline: row.multiline, label, value };
}

export async function readBrowserForm(app: string, result: NativeResult, invoke: Invoke): Promise<BrowserSnapshot> {
  const form = !result.isError && readForm(app, result.text);
  if (!form || form.incomplete) return { ...result, fields: [] };
  const windowKey = form.windowKey || await browserFormWindow(app, result.text, invoke);
  if (!windowKey) return { ...result, fields: [] };
  form.windowKey = windowKey;
  const implicit = form.rows.some(row => row.multiline && row.text && !/(?:^| )Value: /.test(row.text));
  const controls = implicit ? await queryControls(invoke, app, "AXTextArea", 100,
    /^\d+$/.test(windowKey) ? Number(windowKey) : undefined) : undefined;
  const fields = form.rows.flatMap(row => {
    const field = readField(row, controls);
    return field ? [field] : [];
  });
  return { ...result, form, fields };
}

export function browserFormObservation({ form, fields }: BrowserSnapshot) {
  if (!form) return;
  const unique = fields.filter(field => findField(fields, field));
  if (!unique.length) return;
  return [
    form.window.split("\n")[1], form.page, ...form.context,
    ...unique.map(field => `${field.index} ${field.multiline ? "多行" : "单行"}输入框「${field.label}」`),
    browserFormHint,
  ].join("\n");
}

function samePage(before: Form, after: Form) {
  return before.window === after.window && before.page === after.page && before.document === after.document;
}

export function planBrowserFill(app: string, observed: string, windowKey: string, current: BrowserSnapshot, requested: unknown): Plan | { error: string } {
  if (!Array.isArray(requested) || !requested.length || requested.length > maxFields
    || requested.some(field => !field || typeof field.element_index !== "string" || !/^\d+$/.test(field.element_index)
      || typeof field.value !== "string" || field.value.includes("\u0000"))) {
    return { error: "请提供 1 到 20 个网页文字输入框编号和对应的新值。" };
  }
  const before = readForm(app, observed);
  const { form } = current;
  if (!before || !form || !windowKey || form.windowKey !== windowKey || !samePage(before, form)
    || !before.context.every((item, index) => form.context[index] === item)
    || (before.tabs.length && JSON.stringify(before.tabs) !== JSON.stringify(form.tabs))) {
    return { error: "无法核对当前浏览器窗口和表单。请重新读取目标网页并确认页面及输入框。" };
  }
  const fields: PlannedField[] = [];
  for (const { element_index: index, value } of requested) {
    const original = before.rows.find(row => row.index === index);
    const candidates = original ? current.fields.filter(field => field.multiline === original.multiline
      && (original.text === (field.value ? `${field.label} Value: ${field.value}` : field.label)
        || original.text === (field.value ? `${field.label}, Value: ${field.value}` : field.label)
        || (field.multiline && original.text === (field.value ? `${field.label} ${field.value}` : field.label)))) : [];
    const target = candidates.length === 1 && findField(current.fields, candidates[0]);
    if (!target || before.rows.filter(row => row.multiline === original.multiline && row.text === original.text).length !== 1
      || fields.some(field => field.index === target.index)) {
      return { error: `无法唯一核对输入框 ${index} 或其原值已变化。请重新读取并确认目标字段。` };
    }
    if (!target.multiline && /[\r\n]/.test(value)) {
      return { error: `「${target.label}」是单行输入框，请提供单行文字。` };
    }
    fields.push({ ...target, replacement: value.replace(/\r\n?/g, "\n") });
  }
  return { form, fields };
}

export function browserFillReview(plan: Plan) {
  return [
    plan.form.window.split("\n")[1], plan.form.page,
    ...plan.fields.map(field => `输入框「${field.label}」当前值：${field.value.slice(0, 160)}`),
    ...plan.form.context,
    "按请求逐项替换并核对当前表单中的文字。此操作不点击保存或提交。",
  ].join("\n");
}

export async function fillBrowserForm(plan: Plan, observe: () => Promise<BrowserSnapshot>, invoke: Invoke) {
  const { app, windowKey } = plan.form;
  let targets = plan.fields as Field[];
  const expected = new Map(plan.fields.map(field => [field.label, field.value]));
  const verified: string[] = [];
  const failure = (reason: string, uncertain?: string) => ({
    ok: false,
    result: `${reason}\n已核对：${verified.join("、") || "无"}。${uncertain ? `「${uncertain}」可能已变化，请重新读取后再决定是否继续。` : ""}`,
  });

  // Re-read briefly after input delivery. Never repeat a click or write while waiting.
  const read = async (field: PlannedField, check: (state: Form, target: Field) => boolean, replacement?: string) => {
    for (const wait of [0, 100, 200]) {
      if (wait) await delay(wait);
      const snapshot = await observe();
      const state = snapshot.form;
      if (!state || state.windowKey !== windowKey || !samePage(plan.form, state)
        || JSON.stringify(state.context) !== JSON.stringify(plan.form.context)
        || JSON.stringify(state.tabs) !== JSON.stringify(plan.form.tabs)) return false;

      const target = findField(snapshot.fields, field);
      if (!target || plan.fields.some(item => {
        const current = findField(snapshot.fields, item);
        const oldValue = expected.get(item.label);
        return !current || (current.value !== oldValue && !(item === field && current.value === replacement));
      })) return false;

      if (check(state, target)) {
        targets = snapshot.fields;
        return true;
      }
    }
    return false;
  };

  for (const field of plan.fields) {
    const replacement = serialized(field.replacement);
    const target = findField(targets, field)!;
    if (target.value === replacement && !replacement.includes("\\n")) {
      verified.push(field.label);
      continue;
    }
    let writing = false;
    try {
      const clicked = await invoke("click", { app, element_index: target.index, click_method: "sky_click" });
      if (clicked.isError || !await read(field, () => true)) {
        return failure(`点击「${field.label}」后无法核对原表单，已停止填写。`);
      }
      // Indexed writes address the exact control even when background observations omit focus.
      const current = findField(targets, field)!;
      writing = true;
      const direct = await invoke("set_value", { app, element_index: current.index, value: field.replacement });
      if (await read(field, (_state, control) => control.value === replacement, replacement)) {
        expected.set(field.label, replacement);
        verified.push(field.label);
        continue;
      }
      // A failed write can have changed the value. Only try keyboard input after
      // confirming both the unchanged form and the focus on this exact field.
      if (!direct.isError || /[\u0001-\u0009\u000b-\u001f\u007f]/.test(field.replacement)
        || !await read(field, (state, control) => state.focus === control.index)) {
        return failure(`未能确认「${field.label}」的写入结果或焦点，已停止填写。`, field.label);
      }
      writing = false;
      if (field.value) {
        const selected = await invoke("press_key", { app, key: "cmd+a", key_method: "sky_key" });
        if (selected.isError || !await read(field, (state, control) =>
          state.focus === control.index && (state.selection === control.value
            || (state.selection !== undefined && serialized(state.selection) === control.value)))) {
          return failure(`未能确认「${field.label}」的原文已完整选中，已停止填写。`);
        }
      }
      writing = true;
      const written = field.replacement
        ? await invoke("type_text", { app, text: field.replacement, key_method: "sky_key" })
        : await invoke("press_key", { app, key: "backspace", key_method: "sky_key" });
      if (written.isError || !await read(field, (_state, control) => control.value === replacement, replacement)) {
        return failure(`未能核对「${field.label}」的新值，已停止填写。`, field.label);
      }
      expected.set(field.label, replacement);
      verified.push(field.label);
    } catch {
      return failure("填写中断。", writing ? field.label : undefined);
    }
  }
  return { ok: true, result: `已核对 ${verified.length} 个输入框：${verified.join("、")}。请按任务要求检查并另行保存。` };
}
