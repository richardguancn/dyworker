// Codex 式 Markdown 即时渲染编辑器（CodeMirror 6 + 装饰渲染）。
// 文档始终是 markdown 源码，由装饰层决定呈现：
// - 光标停在某一行的行首时，该行显示原始 markdown 源码（可编辑语法标记）；
// - 光标在其余位置时，`**`、`#`、`- ` 等语法标记被隐藏并套用渲染样式，
//   编辑插入的文本按原位写回源码，中文输入法、撤销重做均为原生行为。
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";

export interface MarkdownLiveEditorOptions {
  value: string;
  /** 文档内容变化（即源码变化），由外部负责自动保存 */
  onChange: (value: string) => void;
  /** Ctrl/Cmd+S 时回调（立即落盘） */
  onSaveRequest?: () => void;
  /** 纯源码模式（「查看源代码」）：关闭装饰渲染 */
  plainSource?: boolean;
  placeholderText?: string;
}

export interface MarkdownLiveEditorHandle {
  setPlainSource(plain: boolean): void;
  /** 外部内容同步（草稿恢复等）；编辑器持有焦点时不回写，避免打断输入 */
  setValue(value: string): void;
  focus(): void;
  destroy(): void;
}

// ===== 装饰 =====

const hideMark = Decoration.replace({}); // 零宽隐藏语法标记
const markStrong = Decoration.mark({ class: "cm-md-strong" });
const markEm = Decoration.mark({ class: "cm-md-em" });
const markStrike = Decoration.mark({ class: "cm-md-strike" });
const markInlineCode = Decoration.mark({ class: "cm-md-inlinecode" });
const markLink = Decoration.mark({ class: "cm-md-link" });
const markListMark = Decoration.mark({ class: "cm-md-listmark" });
const markImageAlt = Decoration.mark({ class: "cm-md-image-alt" });

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-md-task${this.checked ? " checked" : ""}`;
    span.textContent = this.checked ? "☑" : "☐";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-rule";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class ImageChipWidget extends WidgetType {
  constructor(readonly alt: string) {
    super();
  }
  eq(other: ImageChipWidget) {
    return other.alt === this.alt;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-md-image-chip";
    span.textContent = this.alt ? `🖼 ${this.alt}` : "🖼";
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const bulletWidget = new BulletWidget();
const ruleWidget = new RuleWidget();

// 行首透视判定：光标（空选区）落在该行行首缩进范围内时，该行显示原始源码。
// 编辑器未持有焦点时不透视，整篇保持渲染态。
export function lineRevealsSource(
  line: { from: number; text: string },
  focused: boolean,
  ranges: readonly { empty: boolean; anchor: number; head: number }[],
) {
  if (!focused) return false;
  const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
  const start = line.from;
  const end = line.from + indent;
  return ranges.some((r) => r.empty && r.anchor >= start && r.anchor <= end && r.head >= start && r.head <= end);
}

// 从语法树收集装饰：语法标记隐藏（零宽 replace）+ 渲染样式（mark/line 装饰）
function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc;
  const ranges = state.selection.ranges;
  const focused = view.hasFocus;
  const lines = new Map<string, Decoration>();
  const spans: Array<{ from: number; to: number; deco: Decoration }> = [];

  const revealed = (pos: number) => lineRevealsSource(doc.lineAt(pos), focused, ranges);
  const lineDeco = (line: { from: number }, className: string) => {
    lines.set(`${line.from}:${className}`, Decoration.line({ class: className }));
  };
  const hide = (from: number, to: number) => {
    if (to > from) spans.push({ from, to, deco: hideMark });
  };
  const mark = (from: number, to: number, deco: Decoration) => {
    if (to > from) spans.push({ from, to, deco });
  };
  const replaceWith = (from: number, to: number, widget: WidgetType) => {
    spans.push({ from, to, deco: Decoration.replace({ widget }) });
  };
  // 语法标记后的单个空格随标记一起隐藏（如 `# `、`- `、`> `）
  const withTrailingSpace = (to: number) => (doc.sliceString(to, to + 1) === " " ? to + 1 : to);
  // 光标（含空选区边界）落在 [from, to] 内
  const selectionTouches = (from: number, to: number) =>
    ranges.some((r) => (r.from < to && r.to > from) || (r.empty && r.head >= from && r.head <= to));
  const eachLine = (from: number, to: number, add: (line: { from: number }) => void) => {
    if (from > to) return;
    for (let pos = from; ; ) {
      const line = doc.lineAt(pos);
      add(line);
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  };

  const iterate = (from: number, to: number) => {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "ATXHeading1":
          case "ATXHeading2":
          case "ATXHeading3":
          case "ATXHeading4":
          case "ATXHeading5":
          case "ATXHeading6": {
            const level = Number(node.name.slice(-1));
            const line = doc.lineAt(node.from);
            if (revealed(line.from)) return true;
            lineDeco(line, `cm-md-h${level}`);
            const headingMark = node.node.getChild("HeaderMark");
            if (headingMark) hide(headingMark.from, withTrailingSpace(headingMark.to));
            return true;
          }
          case "SetextHeading1":
          case "SetextHeading2": {
            const level = node.name === "SetextHeading1" ? 1 : 2;
            const underlineMark = node.node.getChild("HeaderMark");
            if (underlineMark) {
              const underline = doc.lineAt(underlineMark.from);
              if (!revealed(underline.from)) {
                lineDeco(underline, `cm-md-h${level}`);
                hide(underline.from, underline.to);
              }
            }
            return true;
          }
          case "StrongEmphasis": {
            if (revealed(node.from)) return true;
            mark(node.from, node.to, markStrong);
            for (const child of node.node.getChildren("EmphasisMark")) hide(child.from, child.to);
            return true;
          }
          case "Emphasis": {
            if (revealed(node.from)) return true;
            mark(node.from, node.to, markEm);
            for (const child of node.node.getChildren("EmphasisMark")) hide(child.from, child.to);
            return true;
          }
          case "Strikethrough": {
            if (revealed(node.from)) return true;
            mark(node.from, node.to, markStrike);
            for (const child of node.node.getChildren("StrikethroughMark")) hide(child.from, child.to);
            return true;
          }
          case "InlineCode": {
            if (revealed(node.from)) return true;
            mark(node.from, node.to, markInlineCode);
            for (const child of node.node.getChildren("CodeMark")) hide(child.from, child.to);
            return true;
          }
          case "Link": {
            if (revealed(node.from)) return true;
            mark(node.from, node.to, markLink);
            for (const child of node.node.getChildren("LinkMark")) hide(child.from, child.to);
            return true;
          }
          case "Image": {
            if (revealed(node.from)) return true;
            const linkMarks = node.node.getChildren("LinkMark");
            const altStart = linkMarks[0] ? linkMarks[0].to : node.from;
            const altEnd = linkMarks.length > 1 ? linkMarks[1].from : node.to;
            const alt = doc.sliceString(altStart, altEnd).trim();
            if (alt) {
              for (const child of linkMarks) hide(child.from, child.to);
              mark(altStart, altEnd, markImageAlt);
            } else {
              replaceWith(node.from, node.to, new ImageChipWidget(alt));
            }
            return true;
          }
          case "ListMark": {
            if (revealed(node.from)) return true;
            lineDeco(doc.lineAt(node.from), "cm-md-list");
            if (/^[-*+]$/.test(doc.sliceString(node.from, node.to))) {
              // 无序列表标记整体替换为圆点；有序标记保留原文只做弱化
              replaceWith(node.from, withTrailingSpace(node.to), bulletWidget);
            } else {
              mark(node.from, node.to, markListMark);
            }
            return false;
          }
          case "TaskMarker": {
            if (revealed(node.from)) return true;
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            replaceWith(node.from, node.to, new CheckboxWidget(checked));
            return false;
          }
          case "QuoteMark": {
            if (revealed(node.from)) return true;
            hide(node.from, withTrailingSpace(node.to));
            return false;
          }
          case "Blockquote": {
            eachLine(node.from, node.to, (line) => {
              if (!revealed(line.from)) lineDeco(line, "cm-md-quote");
            });
            return true;
          }
          case "FencedCode": {
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to - 1);
            // 光标不在代码块内时隐藏首尾围栏行，进入块内即显示原始围栏
            const fencesVisible = selectionTouches(node.from, node.to);
            if (fencesVisible) {
              eachLine(node.from, node.to, (line) => lineDeco(line, "cm-md-codeblock"));
            } else {
              if (last.from > first.from) eachLine(first.to + 1, last.from - 1, (line) => lineDeco(line, "cm-md-codeblock"));
              hide(first.from, first.to);
              if (last.from > first.from) hide(last.from, last.to);
            }
            return false;
          }
          case "IndentedCode": {
            eachLine(node.from, node.to, (line) => lineDeco(line, "cm-md-codeblock"));
            return false;
          }
          case "HorizontalRule": {
            if (!revealed(node.from)) {
              const line = doc.lineAt(node.from);
              replaceWith(line.from, line.to, ruleWidget);
            }
            return false;
          }
          case "Table": {
            eachLine(node.from, node.to, (line) => lineDeco(line, "cm-md-table"));
            return false;
          }
          case "Escape": {
            if (!revealed(node.from)) hide(node.from, node.from + 1);
            return false;
          }
          default:
            return true;
        }
      },
    });
  };

  for (const range of view.visibleRanges) iterate(range.from, range.to);

  return Decoration.set(
    [
      ...[...lines.entries()].map(([key, deco]) => deco.range(Number(key.split(":")[0]))),
      ...spans.map(({ from, to, deco }) => deco.range(from, to)),
    ],
    true,
  );
}

const liveMarkdownDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// ===== 编辑器组装 =====

export function createMarkdownLiveEditor(host: HTMLElement, options: MarkdownLiveEditorOptions): MarkdownLiveEditorHandle {
  const renderCompartment = new Compartment();
  const extensions: Extension[] = [
    markdown({ extensions: GFM }),
    EditorView.lineWrapping,
    history(),
    keymap.of([
      {
        key: "Mod-s",
        run: () => {
          options.onSaveRequest?.();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    placeholder(options.placeholderText ?? ""),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange(update.state.doc.toString());
    }),
    renderCompartment.of(options.plainSource ? [] : liveMarkdownDecorations),
  ];
  const view = new EditorView({ state: EditorState.create({ doc: options.value, extensions }), parent: host });
  return {
    setPlainSource(plain: boolean) {
      view.dispatch({ effects: renderCompartment.reconfigure(plain ? [] : liveMarkdownDecorations) });
    },
    setValue(value: string) {
      if (view.state.doc.toString() === value) return;
      if (view.hasFocus) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: 0 } });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}
