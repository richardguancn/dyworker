// Open Computer Use v1.1.4's native macOS observation format.
// Keep the original indices: the next native action addresses the fresh tree.
const nodeLine = /^(\t*)(\d+) (.+)$/;
const navigationControl = /^(?:button|radio button|checkbox|tab|menu button|menu item)(?= |$)/;
const editableControl = /^(?:text entry area|text field|combo box) \([^)]*\bsettable\b/;

type Action = { name: string, args: Record<string, any> };

export function macObservationText(text: string) {
  return text.replace(/\n(?:（同时获取到 \d+ 张界面截图。）|Screenshot omitted by include_screenshot=false)(?=\n|$)/g, "").trimEnd();
}

export function navigationObservation(text: string) {
  const [app, window, ...lines] = macObservationText(text).split("\n");
  const visible = lines.filter(line => navigationControl.test(nodeLine.exec(line)?.[3] || ""));
  return [app, window, ...visible, "仅返回导航控件。定位目标标签后，重新读取目标界面以查看正文或操作编辑控件。"].join("\n");
}

function canClickControl(action: Action, description: string) {
  const { name, args } = action;
  const label = description.replace(navigationControl, "").trimStart().replace(/^\([^)]*\)\s*/, "");
  return name === "click" && (args.mouse_button ?? "left") === "left" && (args.click_count ?? 1) === 1
    && args.x === undefined && args.y === undefined
    && navigationControl.test(description) && !/^[\w ]+ \(disabled\)/.test(description)
    && Boolean(label) && !/^(?:Secondary Actions|Value|Frame|ID):/.test(label);
}

export function isNavigationClick(text: string, action: Action) {
  return text.split("\n").some(line => {
    const row = nodeLine.exec(line);
    return row?.[2] === action.args.element_index && canClickControl(action, row[3]);
  });
}

export function macControlEvidence(text: string, action: Action) {
  const lines = macObservationText(text).split("\n");
  const [app, window, root] = lines;
  if (!/^App=.+ \(pid \d+\)$/.test(app || "") || !window?.startsWith('Window: "')
    || !/^0 (?:standard window|floating window|dialog)\b/.test(root || "")
    || lines.some(line => /^(?:\[Accessibility tree truncated|\[.*nodes omitted)/i.test(line))) return undefined;

  const target = lines.map(line => nodeLine.exec(line))
    .find(row => row?.[2] === action.args.element_index);
  if (!target || (!canClickControl(action, target[3])
    && !(action.name === "set_value" && editableControl.test(target[3])))) return undefined;

  const saveDialog = /^0 dialog\b/.test(root) && /(?:保存文件|\bSave (?:File|As)\b)/i.test(window);
  // Keep the directory, filename, selection, form values, and indexed controls.
  // Qt may populate or clear labels of unselected file rows between reads.
  let fileListDepth = -1;
  return lines.map((line, index) => {
    const row = nodeLine.exec(line);
    if (!row) return line;
    const [, indent, id, description] = row;
    if (indent.length <= fileListDepth) fileListDepth = -1;
    if (saveDialog && /^list (?:Files|Sidebar)\b/.test(description)) fileListDepth = indent.length;
    if (id === target[2]) return line;
    if (fileListDepth >= 0 && /^row(?: |$)/.test(description) && !/^row \(/.test(description)) {
      return `${indent}${id} row`;
    }
    const next = nodeLine.exec(lines[index + 1] || "");
    if (/^text(?: |$)/.test(description) && next?.[1] === indent + "\t" && next[3] === "grow area") {
      return `${indent}${id} text`;
    }
    return line;
  }).join("\n");
}
