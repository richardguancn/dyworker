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
type FormRow = {
  index: string, multiline: boolean, text: string,
  placeholder?: string, nearbyLabel?: string, childPlaceholder?: string,
};
type SaveControl = { index: string, label: string, disabled: boolean };
type Form = {
  app: string, window: string, windowKey: string, page: string, document: string, context: string[], tabs: string[],
  rows: FormRow[], saves: SaveControl[], focus?: string, selection?: string, incomplete: boolean,
  verifiedComplete?: boolean,
};
type PlannedField = Field & { replacement: string };
type BrowserSnapshot = NativeResult & { form?: Form, fields: Field[] };
type Plan = { form: Form, fields: PlannedField[] };

const nodeLine = /^(\t*)(\d+) (.+)$/;
const webPage = /^(?:HTML内容|HTML 内容|HTML content|web area) (.+), URL: ((?:https?|file):\/\/\S+)$/i;
const input = /^(text entry area|text field|文本输入区|文本栏) \(settable, string\)(?: (.*))?$/i;
const metadata = /, (?:Placeholder|Help|ID|Secondary Actions): /;
const metaLabelPrefix = /^(?:Placeholder|Help|ID|Secondary Actions): /;
const staticTextNode = /^(?:text|文本) (.+)$/i;
const plainContainerNode = /^(?:container|group|组合)(?: ID: \S+)?$/i;
const serialized = (value: string) => value.replace(/\n/g, "\\n");
const focusLine = /^The focused UI element is (\d+)(?= |\.|$)/m;

function extractPlaceholder(rest: string): string {
  const match = /(?:^|, )Placeholder: (.+?)(?=, (?:Value|Help|ID|Secondary Actions):|$)/.exec(rest);
  return (match?.[1] || "").replace(/,\s*$/, "").trim();
}

function cleanNearbyLabel(raw: string): string {
  const stripped = raw.split(metadata, 1)[0].trim().replace(/[:：]\s*$/, "").trim();
  if (!stripped || stripped.length > 24) return "";
  if (/^(?:https?:|\/\/)/i.test(stripped) || /^\d+\s*\/\s*\d+$/.test(stripped) || /©|\d{4}-\d{4}/.test(stripped)) {
    return "";
  }
  return stripped;
}

export const browserFormHint = "填写当前网页的文字输入框时，用 fill_form 一次传入本页所有待改字段。可用 get_app_state 的 form_only=true 只读取表单。";
export const browserFormUnavailable = "无法从当前网页核对可填写的表单。请确认目标标签页和字段是否已加载。";
export const browserInputUnverified = "当前网页无法核对文字输入的目标。请用 get_app_state 的 form_only=true 读取表单，再用 fill_form 一次填写本页待改字段。若要输入浏览器地址或搜索词，请先聚焦对应输入栏并重新观察。";

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

function resolveFieldsSync(form: Form): Field[] {
  return form.rows.flatMap(row => {
    const field = readField(row);
    return field ? [field] : [];
  });
}

// 仅当目标确实能被 fill_form 唯一命名填写（或树残缺 / Chromium 隐式多行需通过 form_only 补读）时才要求走 fill_form；
// 现代 SPA 中确实无法解析命名的输入框直接放行 set_value，避免死锁。
export function isFillableBrowserFormField(app: string, text: string, index: string) {
  const form = readForm(app, text);
  if (!form) return false;
  const row = form.rows.find(item => item.index === index);
  if (!row) return false;
  if (form.incomplete) return true;
  if (row.multiline && row.text && !/(?:^| )Value: /.test(row.text) && !metaLabelPrefix.test(row.text)) {
    return true;
  }
  const fields = resolveFieldsSync(form);
  const parsed = readField(row);
  return Boolean(parsed && findField(fields, parsed));
}

export function verifiedUnfillableBrowserEditableFocus(app: string, text: string) {
  if (/^\[(?:Accessibility tree truncated|.*nodes omitted)/im.test(text)) return false;
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
      return pageDepth >= 0 && input.test(node[3]) && !isFillableBrowserFormField(app, text, focus);
    }
  }
  return false;
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
  let lastLabel: { depth: number; text: string } | undefined;
  for (const line of lines) {
    const node = nodeLine.exec(line);
    if (!node) continue;
    const [, indent, index, description] = node;
    const depth = indent.length;
    if (depth <= pageDepth) { pageDepth = -1; lastLabel = undefined; }
    if (depth <= controlDepth) controlDepth = -1;
    if (pageDepth < 0) {
      if (/^(?:tab|标签)(?: |$)/i.test(description)) tabs.push(description);
      if (/^container ID: BrowserView\?/.test(description)) document = description;
      if (!webPage.test(description)) continue;
      pageDepth = depth;
      pages.push({ app: appId, window: [app, title, root].join("\n"), windowKey, page: description,
        document, context: [], tabs, rows: [], saves: [], incomplete: /^\[(?:Accessibility tree truncated|.*nodes omitted)/im.test(text) });
      continue;
    }
    const form = pages.at(-1)!;
    if (controlDepth >= 0) {
      const currentRow = form.rows.at(-1);
      const childTextMatch = currentRow && !currentRow.childPlaceholder ? staticTextNode.exec(description) : null;
      if (currentRow && childTextMatch) {
        const cleaned = cleanNearbyLabel(childTextMatch[1]);
        if (cleaned) currentRow.childPlaceholder = cleaned;
      }
      continue;
    }
    const save = /^(?:button|按钮) (\(disabled\) )?(Save|保存)(?=$|,? (?:Help|ID|Description|Secondary Actions):)/i.exec(description);
    if (save) form.saves.push({ index, label: save[2], disabled: Boolean(save[1]) });
    if (/^(?:heading|标题|pop up button|pop-up button|弹出式按钮)(?: |$)/i.test(description)) {
      form.context.push(description.replace(/ \(disabled\)/i, ""));
    }
    const field = input.exec(description);
    if (!field) {
      const textMatch = staticTextNode.exec(description);
      if (textMatch) {
        const cleaned = cleanNearbyLabel(textMatch[1]);
        lastLabel = cleaned ? { depth, text: cleaned } : undefined;
      } else if (!plainContainerNode.test(description)) {
        lastLabel = undefined;
      }
      continue;
    }
    controlDepth = depth;
    const rest = field[2] || "";
    const nearbyLabel = lastLabel && depth >= lastLabel.depth && depth - lastLabel.depth <= 1
      ? lastLabel.text : undefined;
    lastLabel = undefined;
    const placeholder = extractPlaceholder(rest);
    form.rows.push({
      index,
      multiline: /^(?:text entry area|文本输入区)$/i.test(field[1]),
      text: rest.split(metadata, 1)[0].replace(/^Description: /, ""),
      ...(placeholder ? { placeholder } : {}),
      ...(nearbyLabel ? { nearbyLabel } : {}),
    });
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

type QueryControlMatch = { title?: string, description?: string, value?: string };
type QueryResult = { window_id?: number, truncated?: boolean, matches?: QueryControlMatch[] };
async function queryControls(invoke: Invoke, app: string, role: string, limit: number, windowId?: number, text?: string) {
  const result = await invoke("query", {
    app, role, limit, max_nodes: 5000,
    ...(windowId ? { window_id: windowId } : {}),
    ...(text ? { text } : {}),
  });
  if (result.isError) return;
  try { return JSON.parse(result.text) as QueryResult; }
  catch { return undefined; }
}

const matchLabelOf = (control: QueryControlMatch) => String(control.title || control.description || "").replace(/,$/, "").trim();

function matchesPageIdentity(matches: QueryControlMatch[], page: string) {
  const parsed = webPage.exec(page);
  if (!parsed) return true;
  const pageTitle = parsed[1].trim();
  const pageUrl = parsed[2].trim();
  const informative = matches.filter(match => match.title || match.description || match.value);
  if (!informative.length) return false;
  return informative.some(match => [match.title, match.description, match.value].some(value => {
    const text = String(value || "").trim();
    return Boolean(text && ((pageUrl && text.includes(pageUrl)) || (pageTitle && text === pageTitle)));
  }));
}

async function verifyTruncatedForm(app: string, form: Form, fields: Field[], invoke: Invoke): Promise<Field[] | undefined> {
  const explicitWindowId = /^\d+$/.test(form.windowKey) ? Number(form.windowKey) : undefined;
  const webAreas = await queryControls(invoke, app, "AXWebArea", 20, explicitWindowId);
  if (!webAreas || webAreas.truncated !== false || !Array.isArray(webAreas.matches) || !webAreas.matches.length) return;
  const windowId = explicitWindowId || (Number.isInteger(webAreas.window_id) && webAreas.window_id! > 0 ? webAreas.window_id : undefined);
  if (!windowId || (explicitWindowId && webAreas.window_id && webAreas.window_id !== explicitWindowId)) return;
  if (!matchesPageIdentity(webAreas.matches, form.page)) return;

  const [textFields, textAreas, buttons] = await Promise.all([
    queryControls(invoke, app, "AXTextField", 100, windowId),
    queryControls(invoke, app, "AXTextArea", 100, windowId),
    queryControls(invoke, app, "AXButton", 100, windowId),
  ]);
  if (!textFields || textFields.truncated !== false || !Array.isArray(textFields.matches)) return;
  if (!textAreas || textAreas.truncated !== false || !Array.isArray(textAreas.matches)) return;
  if ((textFields.window_id && textFields.window_id !== windowId)
    || (textAreas.window_id && textAreas.window_id !== windowId)) return;
  if (!buttons) return;

  if (buttons.truncated === false && Array.isArray(buttons.matches)) {
    if (buttons.window_id && buttons.window_id !== windowId) return;
    const queriedSaves = buttons.matches.filter(btn => /^(?:Save|保存)$/i.test(matchLabelOf(btn)));
    if (queriedSaves.length !== form.saves.length) return;
  } else {
    const saveLabels = [...new Set(["Save", "保存", ...form.saves.map(save => save.label)])];
    for (const label of saveLabels) {
      const matched = await queryControls(invoke, app, "AXButton", 50, windowId, label);
      if (!matched || matched.truncated !== false || !Array.isArray(matched.matches)) return;
      if (matched.window_id && matched.window_id !== windowId) return;
      const exactCount = matched.matches.filter(btn => matchLabelOf(btn).toLowerCase() === label.toLowerCase()).length;
      const visibleCount = form.saves.filter(save => save.label.toLowerCase() === label.toLowerCase()).length;
      if (exactCount !== visibleCount) return;
    }
  }

  const reParsed = form.rows.flatMap(row => {
    const field = readField(row, textAreas);
    return field ? [field] : [];
  });
  const poolFields = reParsed.length ? reParsed : fields;
  const allInputs = [...textFields.matches, ...textAreas.matches];
  const verified = poolFields.filter(field => {
    const roleMatches = (field.multiline ? textAreas.matches! : textFields.matches!)
      .filter(control => matchLabelOf(control) === field.label);
    const totalMatches = allInputs.filter(control => matchLabelOf(control) === field.label);
    if (roleMatches.length !== 1 || totalMatches.length !== 1) return false;
    if (typeof roleMatches[0].value === "string" && serialized(roleMatches[0].value) !== field.value) return false;
    return true;
  });
  return verified.length ? verified : undefined;
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
  if (metaLabelPrefix.test(label)) label = "";
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
  if (!label) label = row.nearbyLabel || row.placeholder || row.childPlaceholder || "";
  if (!label || metaLabelPrefix.test(label)) return;
  return { index: row.index, multiline: row.multiline, label, value };
}

export async function readBrowserForm(app: string, result: NativeResult, invoke: Invoke): Promise<BrowserSnapshot> {
  const form = !result.isError && readForm(app, result.text);
  if (!form) return { ...result, fields: [] };
  const windowKey = form.windowKey || await browserFormWindow(app, result.text, invoke);
  if (!windowKey) return { ...result, fields: [] };
  form.windowKey = windowKey;
  const implicit = form.rows.some(row => row.multiline && row.text && !/(?:^| )Value: /.test(row.text) && !metaLabelPrefix.test(row.text));
  const controls = !form.incomplete && implicit ? await queryControls(invoke, app, "AXTextArea", 100,
    /^\d+$/.test(windowKey) ? Number(windowKey) : undefined) : undefined;
  const fields = form.rows.flatMap(row => {
    const field = readField(row, controls);
    return field ? [field] : [];
  });
  if (form.incomplete) {
    const verifiedFields = await verifyTruncatedForm(app, form, fields, invoke);
    if (!verifiedFields) return { ...result, fields: [] };
    form.verifiedComplete = true;
    return { ...result, form, fields: verifiedFields };
  }
  return { ...result, form, fields };
}

export function browserFormObservation({ form, fields }: BrowserSnapshot) {
  if (!form) return;
  const unique = fields.filter(field => findField(fields, field));
  if (!unique.length) return;
  return [
    form.window.split("\n")[1], form.page, ...form.context,
    ...unique.map(field => `${field.index} ${field.multiline ? "多行" : "单行"}输入框「${field.label}」`),
    ...form.saves.map(save => `${save.index} 按钮「${save.label}」${save.disabled ? "（不可用）" : "（可用）"}`),
    browserFormHint,
  ].join("\n");
}

function samePage(before: Form, after: Form) {
  return before.window === after.window && before.page === after.page && before.document === after.document;
}

function sameFormScope(before: Form, after: Form) {
  return before.windowKey === after.windowKey && samePage(before, after)
    && JSON.stringify(before.context) === JSON.stringify(after.context)
    && JSON.stringify(before.tabs) === JSON.stringify(after.tabs);
}

export function browserFormSave(before: BrowserSnapshot, index: string) {
  const saves = before.form?.saves;
  return saves?.length === 1 && saves[0].index === index && !saves[0].disabled ? saves[0] : undefined;
}

export function matchBrowserFormSave(before: BrowserSnapshot, after: BrowserSnapshot, save: SaveControl, labels: string[]) {
  if (!before.form || !after.form || !sameFormScope(before.form, after.form)) return;
  for (const label of labels) {
    const field = before.fields.find(item => item.label === label);
    if (!field || findField(after.fields, field)?.value !== field.value) return;
  }
  const saves = after.form.saves;
  return saves.length === 1 && saves[0].label === save.label ? saves[0] : undefined;
}

export function planBrowserFill(app: string, observed: string, windowKey: string, current: BrowserSnapshot, requested: unknown): Plan | { error: string } {
  if (!Array.isArray(requested) || !requested.length || requested.length > maxFields
    || requested.some(field => !field || typeof field.element_index !== "string" || !/^\d+$/.test(field.element_index)
      || typeof field.value !== "string" || field.value.includes("\u0000"))) {
    return { error: "请提供 1 到 20 个网页文字输入框编号和对应的新值。" };
  }
  const before = readForm(app, observed);
  const { form } = current;
  if (!before || !form || (form.incomplete && !form.verifiedComplete) || !windowKey || form.windowKey !== windowKey || !samePage(before, form)
    || !before.context.every((item, index) => form.context[index] === item)
    || (before.tabs.length && JSON.stringify(before.tabs) !== JSON.stringify(form.tabs))) {
    return { error: "无法核对当前浏览器窗口和表单。请重新读取目标网页并确认页面及输入框。" };
  }
  const fields: PlannedField[] = [];
  for (const { element_index: index, value } of requested) {
    const original = before.rows.find(row => row.index === index);
    const parsedBefore = original ? readField(original) : undefined;
    const candidates = original ? current.fields.filter(field => field.multiline === original.multiline
      && (original.text === (field.value ? `${field.label} Value: ${field.value}` : field.label)
        || original.text === (field.value ? `${field.label}, Value: ${field.value}` : field.label)
        || (field.multiline && original.text === (field.value ? `${field.label} ${field.value}` : field.label))
        || (parsedBefore && field.label === parsedBefore.label && field.value === parsedBefore.value))) : [];
    const target = candidates.length === 1 && findField(current.fields, candidates[0]);
    const duplicateInBefore = original ? before.rows.filter(row => {
      if (row.multiline !== original.multiline) return false;
      if (parsedBefore) {
        const other = readField(row);
        if (other) return other.label === parsedBefore.label && other.value === parsedBefore.value;
      }
      return row.text === original.text;
    }).length !== 1 : true;
    if (!target || duplicateInBefore || fields.some(field => field.index === target.index)) {
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

export async function fillBrowserForm(plan: Plan, initial: BrowserSnapshot, observe: () => Promise<BrowserSnapshot>, invoke: Invoke) {
  const { app } = plan.form;
  let latest = initial;
  let targets = plan.fields as Field[];
  const expected = new Map(plan.fields.map(field => [field.label, field.value]));
  const verified: string[] = [];
  let readIssue = "";
  const failure = (reason: string, uncertain?: string) => ({
    ok: false,
    result: `${reason}\n已核对：${verified.join("、") || "无"}。${uncertain ? `「${uncertain}」可能已变化，请重新读取后再决定是否继续。` : ""}`,
  });

  // Re-read briefly after input delivery. Never repeat a click or write while waiting.
  const read = async (field: PlannedField, check: (state: Form, target: Field) => boolean, replacement?: string) => {
    readIssue = "字段的值、焦点或选区尚未达到预期";
    for (const wait of [0, 100, 200]) {
      if (wait) await delay(wait);
      const snapshot = await observe();
      const state = snapshot.form;
      if (!state) {
        readIssue = "未能读取完整表单";
        continue;
      }
      if (!sameFormScope(plan.form, state)) {
        readIssue = "窗口、网页或表单范围已变化";
        return false;
      }

      const target = findField(snapshot.fields, field);
      if (!target || plan.fields.some(item => {
        const current = findField(snapshot.fields, item);
        return !current;
      })) {
        readIssue = "目标输入框缺失或无法唯一识别";
        continue;
      }
      if (plan.fields.some(item => {
        const current = findField(snapshot.fields, item)!;
        return current.value !== expected.get(item.label) && !(item === field && current.value === replacement);
      })) {
        readIssue = "表单中的字段值已变化";
        return false;
      }

      if (check(state, target)) {
        latest = snapshot;
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
      const writeValue = () => invoke("set_value", {
        app, element_index: findField(targets, field)!.index, value: field.replacement,
      });
      const verifyValue = () => read(field, (_state, control) => control.value === replacement, replacement);
      const confirm = () => {
        expected.set(field.label, replacement);
        verified.push(field.label);
      };
      writing = true;
      let direct = await writeValue();
      if (await verifyValue()) {
        confirm();
        continue;
      }
      if (!direct.isError || !await read(field, () => true)) {
        return failure(`「${field.label}」写入后未能核对：${readIssue}。已停止填写。`, field.label);
      }
      writing = false;

      // Some controls only accept a targeted write after receiving a click.
      // Recheck the entire requested form before retrying the write.
      const clicked = await invoke("click", { app, element_index: findField(targets, field)!.index, click_method: "sky_click" });
      if (clicked.isError) return failure(`未能定位「${field.label}」，已停止填写。`);
      if (!await read(field, () => true)) {
        return failure(`点击「${field.label}」后无法核对原表单：${readIssue}。已停止填写。`);
      }
      writing = true;
      direct = await writeValue();
      if (await verifyValue()) {
        confirm();
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
      confirm();
    } catch {
      return failure("填写中断。", writing ? field.label : undefined);
    }
  }
  return { ok: true as const, result: `已核对 ${verified.length} 个输入框：${verified.join("、")}。新值已逐项读回一致。`,
    snapshot: latest, verified };
}
