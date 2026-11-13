import { setTimeout as delay } from "node:timers/promises";

// Notepad-- exposes editable search fields and a current-document replace
// button even when its editor does not accept an accessibility value write.
export const notepadApp = "www.itdp.cn";
export const notepadReplace = "replace_document_text";

type Args = { old_text?: unknown, new_text?: unknown };
type Invoke = (name: string, input: Record<string, unknown>) => Promise<{ text: string, isError?: boolean }>;

function unique<T>(matches: T[]): T | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}

function readDocument(text: string) {
  const [app, window] = text.split("\n");
  if (!app.startsWith(`App=${notepadApp} (pid `) || !window?.startsWith('Window: "')
    || !/^0 standard window\b/m.test(text) || /^\[Accessibility tree truncated/im.test(text)) return;
  const body = unique([...text.matchAll(/^\t\d+ text entry area \([^)]*\)(?: (.*))?$/gm)]);
  const replace = unique([...text.matchAll(/^\t(\d+) button (?:替换|Replace)(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  if (!body || !replace) return;
  const draft = /^Window: "((?:New|新建) \d+) \[(?:文本模式|Text Mode)\]", App: Notepad--\.$/i.exec(window)?.[1];
  const isDraft = !!draft && text.split("\n").some(line => /^\t\t\d+ radio button /.test(line) && line.endsWith(` radio button ${draft}`));
  const autoSave = unique([...text.matchAll(/^\t\d+ checkbox (?:Description: )?(?:周期自动保存|Periodic Auto Save),? Value: (on|off)(?:,? Secondary Actions: [^\n]*)?$/gim)])?.[1];
  return { app, window, body: (body[1] || "").replace(/(?:,? )?Secondary Actions: [^\n]*$/, ""), replace: replace[1], canEditWithoutSaving: isDraft || autoSave === "off" };
}

type ReplacementPlan = { document: NonNullable<ReturnType<typeof readDocument>>, oldText: string, newText: string, expected: string };

export function planNotepadReplace(observed: string, current: string, args: Args): ReplacementPlan | { error: string } {
  const { old_text: oldText, new_text: newText } = args;
  if (typeof oldText !== "string" || !oldText || typeof newText !== "string" || oldText === newText
    || /[\r\n\\]/.test(oldText) || /[\r\n\\]/.test(newText)) {
    return { error: "请提供不同的单行原文和新文字，使用普通文字替换。" };
  }
  const before = readDocument(observed);
  const document = readDocument(current);
  if (!before || !document || document.app !== before.app || document.window !== before.window || document.body !== before.body) {
    return { error: "无法确认 Notepad-- 中仍是刚才读取的文档和正文，请重新观察目标标签。" };
  }
  if (!document.canEditWithoutSaving) {
    return { error: "未能确认此文件的周期自动保存已关闭。为遵守不保存的要求，未执行替换。" };
  }
  // Count overlapping matches as ambiguous too.
  const offset = document.body.indexOf(oldText);
  if (offset < 0 || document.body.indexOf(oldText, offset + 1) >= 0) {
    return { error: "目标原文在当前正文中没有唯一匹配，未执行替换。" };
  }
  const expected = document.body.slice(0, offset) + newText + document.body.slice(offset + oldText.length);
  return { document, oldText, newText, expected };
}

function readReplaceDialog(text: string, app: string) {
  if (!text.startsWith(`${app}\n`) || !/^0 floating window\b/m.test(text)
    || !/^\t\d+ text (?:查找目标[：:]|Find what:)/mi.test(text)
    || !/^\t\d+ text (?:替换为[：:]|Replace with:)/mi.test(text)) return;

  const fields = [...text.matchAll(/^\t\t(\d+) text field \([^)]*\bsettable\b[^)]*\)(?: Value: (.*?))?(?:,? Secondary Actions: [^\n]*)?$/gm)];
  const normal = unique([...text.matchAll(/^\t\t(\d+) radio button (?:普通|Normal) Value: (on|off)(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  const replace = unique([...text.matchAll(/^\t(\d+) button (?:在当前文件中替换(?:\(A\))?|Replace All in Current (?:Document|File))(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  const close = unique([...text.matchAll(/^\t(\d+) button (?:关闭|Close)(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  const matchCase = unique([...text.matchAll(/^\t(\d+) checkbox (?:匹配大小写|Match case) Value: (on|off)(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  const wholeWord = unique([...text.matchAll(/^\t(\d+) checkbox (?:全词匹配|Match whole word(?: only)?) Value: (on|off)(?:,? Secondary Actions: [^\n]*)?$/gim)]);
  if (fields.length !== 2 || !normal || !replace || !close || !matchCase || !wholeWord) return;
  return {
    find: { index: fields[0][1], value: fields[0][2] || "" },
    replacement: { index: fields[1][1], value: fields[1][2] || "" },
    normal: { index: normal[1], on: normal[2] === "on" },
    matchCase: { index: matchCase[1], on: matchCase[2] === "on" },
    wholeWord: { index: wholeWord[1], on: wholeWord[2] === "on" },
    replace: replace[1], close: close[1],
  };
}

export async function replaceNotepadText(
  plan: ReplacementPlan,
  observe: () => Promise<{ text: string, isError?: boolean }>,
  invoke: Invoke,
) {
  const action = async (name: string, index: string, value?: string) => {
    const result = await invoke(name, {
      app: notepadApp, element_index: index,
      ...(name === "click" ? { click_method: "accessibility" } : { value }),
    });
    return !result.isError;
  };
  const readDialog = async () => {
    const result = await observe();
    return !result.isError ? readReplaceDialog(result.text, plan.document.app) : undefined;
  };

  if (!await action("click", plan.document.replace)) return { error: "未能打开 Notepad-- 的替换窗口。" };
  let dialog = await readDialog();
  if (!dialog) return { error: "无法确认 Notepad-- 的查找替换窗口，正文替换未执行。" };

  for (const [field, value] of [["find", plan.oldText], ["replacement", plan.newText]] as const) {
    if (dialog[field].value === value) continue;
    if (!await action("set_value", dialog[field].index, value)) return { error: "替换窗口的输入没有生效，正文替换未执行。" };
    dialog = await readDialog();
    if (!dialog || dialog[field].value !== value) return { error: "未能核对替换窗口的输入，正文替换未执行。" };
  }
  for (const [option, on] of [["normal", true], ["matchCase", true], ["wholeWord", false]] as const) {
    if (dialog[option].on === on) continue;
    if (!await action("click", dialog[option].index)) return { error: "未能设置精确查找条件，正文替换未执行。" };
    dialog = await readDialog();
    if (!dialog || dialog[option].on !== on) return { error: "未能核对精确查找条件，正文替换未执行。" };
  }
  if (!dialog.normal.on || !dialog.matchCase.on || dialog.wholeWord.on
    || dialog.find.value !== plan.oldText || dialog.replacement.value !== plan.newText) {
    return { error: "查找模式或文字已变化，正文替换未执行。" };
  }

  // Never replay a document write if its result is uncertain.
  if (!await action("click", dialog.replace)) return { error: "应用未确认本次替换，请重新读取正文核对结果。" };
  const after = await readDialog();
  if (!after || !await action("click", after.close)) return { error: "已发出替换动作，但未能返回正文复读，请先核对结果。" };
  let result = await observe();
  // The dialog can still be reported briefly after pressing Close.
  for (let attempt = 0; attempt < 4 && !result.isError && readReplaceDialog(result.text, plan.document.app); attempt++) {
    await delay(150);
    result = await observe();
  }
  const verified = !result.isError && readDocument(result.text);
  if (!verified || verified.app !== plan.document.app || verified.window !== plan.document.window
    || verified.body !== plan.expected) return { error: "复读结果与预期不一致，请先核对正文。" };
  return { text: `${verified.window}\n已替换 1 处并复读核对正文。未执行保存。` };
}
