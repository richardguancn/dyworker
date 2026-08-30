import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Circle,
  Copy,
  Gauge,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import hljs from "highlight.js/lib/common";
import { localImagePathFromSource } from "../electron/local-image-path.mjs";

const localImageMarker = "dyworker-local-image:";

export function markdownUrlTransform(url: string, _key: string, node: Readonly<{ tagName: string }>) {
  if (node.tagName === "img") {
    const filePath = localImagePathFromSource(url);
    if (filePath) return `${localImageMarker}${encodeURIComponent(filePath)}`;
  }
  return defaultUrlTransform(url);
}

type LocalImageState =
  | { status: "loading" }
  | { status: "loaded"; dataUrl: string }
  | { status: "error"; error: string };

type LocalImageReadResult = { ok: boolean; dataUrl?: string; error?: string };
const localImageReads = new Map<string, Promise<LocalImageReadResult>>();
const localImageReadQueue: Array<() => void> = [];
const maxConcurrentLocalImageReads = 3;
let activeLocalImageReads = 0;

function drainLocalImageReadQueue() {
  while (activeLocalImageReads < maxConcurrentLocalImageReads && localImageReadQueue.length) {
    const start = localImageReadQueue.shift();
    if (!start) break;
    activeLocalImageReads += 1;
    start();
  }
}

function scheduleLocalImageRead(reader: () => Promise<LocalImageReadResult>) {
  return new Promise<LocalImageReadResult>((resolve) => {
    localImageReadQueue.push(() => {
      void reader()
        .then(resolve)
        .catch(() => resolve({ ok: false, error: "图片不存在或读取失败" }))
        .finally(() => {
          activeLocalImageReads -= 1;
          drainLocalImageReadQueue();
        });
    });
    drainLocalImageReadQueue();
  });
}

function readLocalImage(filePath: string): Promise<LocalImageReadResult> {
  const pending = localImageReads.get(filePath);
  if (pending) return pending;
  const reader = window.dyworker?.readLocalImage;
  if (!reader) return Promise.resolve<LocalImageReadResult>({ ok: false, error: "当前环境无法读取本地图片" });
  const request = scheduleLocalImageRead(() => reader(filePath))
    .finally(() => {
      if (localImageReads.get(filePath) === request) localImageReads.delete(filePath);
    });
  localImageReads.set(filePath, request);
  return request;
}

function LocalMarkdownImage({ encodedPath, alt }: { encodedPath: string; alt: string }) {
  const [state, setState] = useState<LocalImageState>({ status: "loading" });
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setShouldLoad(entry.isIntersecting);
    }, { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [encodedPath]);

  useEffect(() => {
    if (!shouldLoad) {
      setState({ status: "loading" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    let filePath = "";
    try {
      filePath = decodeURIComponent(encodedPath);
    } catch {
      setState({ status: "error", error: "图片地址无效" });
      return () => { active = false; };
    }
    void readLocalImage(filePath).then((result) => {
      if (!active) return;
      if (result.ok && result.dataUrl) setState({ status: "loaded", dataUrl: result.dataUrl });
      else setState({ status: "error", error: result.error || "图片无法显示" });
    });
    return () => { active = false; };
  }, [encodedPath, shouldLoad]);

  return (
    <span className={`markdown-local-image ${state.status}`} ref={containerRef}>
      {state.status === "loaded" ? (
        <img src={state.dataUrl} alt={alt} loading="lazy" />
      ) : (
        <span className="markdown-local-image-status">
          {state.status === "loading" ? "正在加载图片…" : state.error}
        </span>
      )}
      {alt && <span className="markdown-local-image-caption">{alt}</span>}
    </span>
  );
}

function MarkdownImage({ src, alt, node: _node, ...props }: ComponentPropsWithoutRef<"img"> & { node?: unknown }) {
  if (typeof src === "string" && src.startsWith(localImageMarker)) {
    return <LocalMarkdownImage encodedPath={src.slice(localImageMarker.length)} alt={alt || "本地图片"} />;
  }
  return <img {...props} src={src} alt={alt || "图片"} loading="lazy" />;
}

// 从 react-markdown 的 <pre> 子树里还原代码原文，用于一键复制
function extractCodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractCodeText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

async function copyCodeText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Electron 剪贴板权限被系统拦截时走兼容方案
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

function MarkdownPre({ children, node: _node, ...props }: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const handleCopy = () => {
    // 代码高亮后正文存于 DOM，优先读 textContent；退化场景再从 React 子树还原
    const text = (preRef.current?.textContent || extractCodeText(children)).replace(/\n$/, "");
    void copyCodeText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <div className="code-block-wrap">
      <button
        type="button"
        className={`code-copy-button${copied ? " copied" : ""}`}
        onClick={handleCopy}
        aria-label={copied ? "已复制代码" : "复制代码"}
        title={copied ? "已复制" : "复制代码"}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? "已复制" : "复制"}</span>
      </button>
      <pre {...props} ref={preRef}>{children}</pre>
    </div>
  );
}

// 代码块语法高亮（highlight.js 公共语言集）：流式输出与最终渲染共用本组件，
// 不完整的代码同样可以高亮，随增量刷新稳定保持配色；未标注语言或语言不认识时保持纯文本，
// 不做自动探测——流式期间自动探测会让同一段代码前后变色。
function MarkdownCode({ className, children, node: _node, ...props }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) {
  const language = /language-([\w+#.-]+)/.exec(String(className || ""))?.[1]?.toLowerCase();
  const text = Array.isArray(children) ? children.join("") : String(children ?? "");
  const highlighted = useMemo(() => {
    if (!language || !hljs.getLanguage(language)) return null;
    try {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }, [language, text]);
  // mermaid 图表不走语法高亮，交给懒加载的 mermaid 引擎画 SVG
  if (language === "mermaid") {
    return <code {...props} className={className || "language-mermaid"}><MermaidDiagram code={text} /></code>;
  }
  if (highlighted != null) {
    return <code {...props} className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />;
  }
  return <code {...props} className={className}>{children}</code>;
}

// mermaid 按需加载：只有消息里真的出现 mermaid 代码块时才拉取图表引擎（约 1MB 的异步分包）
let mermaidLoader: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((module) => {
      module.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      return module;
    });
  }
  return mermaidLoader;
}

// mermaid 图表渲染：流式输出期间语法尚未完整时静默等待，收尾后重渲染出图
function MermaidDiagram({ code }: { code: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "done"; svg: string } | { status: "error"; message: string }>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    loadMermaid()
      .then((mermaid) => mermaid.default.render(`dyworker-mermaid-${crypto.randomUUID().slice(0, 8)}`, code))
      .then((result) => {
        if (active) setState({ status: "done", svg: result.svg });
      })
      .catch((renderError) => {
        if (active) setState({ status: "error", message: renderError instanceof Error ? renderError.message : String(renderError) });
      });
    return () => { active = false; };
  }, [code]);
  if (state.status === "loading") return <div className="mermaid-diagram mermaid-pending">图表渲染中…</div>;
  if (state.status === "error") {
    return (
      <div className="mermaid-diagram mermaid-error">
        <p>图表渲染失败（输出未完成或语法有误）</p>
        <div className="mermaid-error-source">{code}</div>
      </div>
    );
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

// 中英文之间自动补空格（pangu 风格）：只作用于正文文本节点，
// 代码块/行内代码/数学公式/HTML 原样保留，避免破坏代码与公式
interface AutoSpaceNode {
  type?: string;
  value?: unknown;
  children?: AutoSpaceNode[];
}
const autoSpaceCjk = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3000-\\u303f\\uff01-\\uff60";
const autoSpaceCjkToLatin = new RegExp(`([${autoSpaceCjk}])([A-Za-z0-9])`, "g");
const autoSpaceLatinToCjk = new RegExp(`([A-Za-z0-9])([${autoSpaceCjk}])`, "g");
function remarkAutoSpace() {
  return (tree: AutoSpaceNode) => {
    const walk = (node: AutoSpaceNode) => {
      if (node.type === "code" || node.type === "inlineCode" || node.type === "math" || node.type === "inlineMath" || node.type === "html") return;
      if (node.type === "text" && typeof node.value === "string") {
        node.value = node.value.replace(autoSpaceCjkToLatin, "$1 $2").replace(autoSpaceLatinToCjk, "$1 $2");
      }
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
  };
}

const markdownComponents = { img: MarkdownImage, pre: MarkdownPre, code: MarkdownCode };

interface Metric {
  label: string;
  value: string;
  hint?: string;
}

interface ChoiceOption {
  id: string;
  label: string;
  description?: string;
  tag?: string;
  summary?: string;
  metrics?: Metric[];
}

interface ChoiceWidget {
  type: "choice";
  title: string;
  description?: string;
  defaultId?: string;
  options: ChoiceOption[];
}

interface SliderFeedback {
  from: number;
  label: string;
  description?: string;
}

interface SliderWidget {
  type: "slider";
  title: string;
  description?: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value?: number;
  unit?: string;
  feedback?: SliderFeedback[];
}

interface BarItem {
  id: string;
  label: string;
  value: number;
  max?: number;
  unit?: string;
  detail?: string;
}

interface BarsWidget {
  type: "bars";
  title: string;
  description?: string;
  defaultId?: string;
  items: BarItem[];
}

interface StepItem {
  label: string;
  description?: string;
}

interface StepsWidget {
  type: "steps";
  title: string;
  description?: string;
  current?: number;
  steps: StepItem[];
}

type InteractiveWidget = ChoiceWidget | SliderWidget | BarsWidget | StepsWidget;

type MessageSegment =
  | { kind: "markdown"; content: string }
  | { kind: "widget"; widget: InteractiveWidget };

const WIDGET_PATTERN = /```dyworker-ui[ \t]*\r?\n([\s\S]*?)```/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isMetric(value: unknown): value is Metric {
  return isRecord(value)
    && isText(value.label)
    && isText(value.value)
    && isOptionalText(value.hint);
}

function isWidget(value: unknown): value is InteractiveWidget {
  if (!isRecord(value)
    || !isText(value.type)
    || !isText(value.title)
    || !isOptionalText(value.description)) return false;

  if (value.type === "choice") {
    return isOptionalText(value.defaultId)
      && Array.isArray(value.options)
      && value.options.length > 0
      && value.options.length <= 8
      && value.options.every((option) => isRecord(option)
        && isText(option.id)
        && isText(option.label)
        && isOptionalText(option.description)
        && isOptionalText(option.tag)
        && isOptionalText(option.summary)
        && (!option.metrics || (Array.isArray(option.metrics) && option.metrics.length <= 6 && option.metrics.every(isMetric))));
  }

  if (value.type === "slider") {
    return isText(value.label)
      && isFiniteNumber(value.min)
      && isFiniteNumber(value.max)
      && value.max > value.min
      && (value.step === undefined || (isFiniteNumber(value.step) && value.step > 0))
      && (value.value === undefined || isFiniteNumber(value.value))
      && isOptionalText(value.unit)
      && (!value.feedback || (Array.isArray(value.feedback)
        && value.feedback.length <= 10
        && value.feedback.every((item) => isRecord(item)
          && isFiniteNumber(item.from)
          && isText(item.label)
          && isOptionalText(item.description))));
  }

  if (value.type === "bars") {
    return isOptionalText(value.defaultId)
      && Array.isArray(value.items)
      && value.items.length > 0
      && value.items.length <= 12
      && value.items.every((item) => isRecord(item)
        && isText(item.id)
        && isText(item.label)
        && isFiniteNumber(item.value)
        && (item.max === undefined || (isFiniteNumber(item.max) && item.max > 0))
        && isOptionalText(item.unit)
        && isOptionalText(item.detail));
  }

  if (value.type === "steps") {
    return (value.current === undefined || (Number.isInteger(value.current) && Number(value.current) >= 0))
      && Array.isArray(value.steps)
      && value.steps.length > 0
      && value.steps.length <= 10
      && value.steps.every((step) => isRecord(step) && isText(step.label) && isOptionalText(step.description));
  }

  return false;
}

export function parseInteractiveMessage(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let cursor = 0;
  WIDGET_PATTERN.lastIndex = 0;

  for (const match of content.matchAll(WIDGET_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ kind: "markdown", content: content.slice(cursor, index) });
    try {
      const candidate: unknown = JSON.parse(match[1]);
      if (isWidget(candidate)) {
        segments.push({ kind: "widget", widget: candidate });
      } else {
        segments.push({ kind: "markdown", content: match[0] });
      }
    } catch {
      segments.push({ kind: "markdown", content: match[0] });
    }
    cursor = index + match[0].length;
  }

  if (cursor < content.length) segments.push({ kind: "markdown", content: content.slice(cursor) });
  return segments.length ? segments : [{ kind: "markdown", content }];
}

function WidgetHeading({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="interactive-heading">
      <span className="interactive-heading-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </div>
  );
}

function ChoiceView({ widget }: { widget: ChoiceWidget }) {
  const initial = widget.options.find((option) => option.id === widget.defaultId)?.id || widget.options[0].id;
  const [selectedId, setSelectedId] = useState(initial);
  const selected = widget.options.find((option) => option.id === selectedId) || widget.options[0];

  return (
    <section className="interactive-block interactive-choice">
      <WidgetHeading icon={<ListChecks size={16} />} title={widget.title} description={widget.description} />
      <div className="choice-options" role="radiogroup" aria-label={widget.title}>
        {widget.options.map((option) => {
          const active = option.id === selected.id;
          return (
            <button
              type="button"
              className={`choice-option ${active ? "active" : ""}`}
              key={option.id}
              role="radio"
              aria-checked={active}
              onClick={() => setSelectedId(option.id)}
            >
              <span className="choice-radio">{active ? <Check size={12} /> : <Circle size={12} />}</span>
              <span className="choice-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.tag && <span className="choice-tag">{option.tag}</span>}
            </button>
          );
        })}
      </div>
      {Boolean(selected.metrics?.length) && (
        <div className="interactive-metrics">
          {selected.metrics?.map((metric, index) => (
            <div className="interactive-metric" key={`${metric.label}-${index}`}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.hint && <small>{metric.hint}</small>}
            </div>
          ))}
        </div>
      )}
      {(selected.summary || selected.description) && (
        <p className="interactive-summary">
          <span>已选择“{selected.label}”</span>
          {selected.summary || selected.description}
        </p>
      )}
    </section>
  );
}

function SliderView({ widget }: { widget: SliderWidget }) {
  const safeStep = widget.step && widget.step > 0 ? widget.step : 1;
  const initial = Math.min(widget.max, Math.max(widget.min, widget.value ?? widget.min));
  const [value, setValue] = useState(initial);
  const progress = ((value - widget.min) / (widget.max - widget.min)) * 100;
  const feedback = [...(widget.feedback || [])]
    .sort((left, right) => left.from - right.from)
    .filter((item) => value >= item.from)
    .at(-1);

  return (
    <section className="interactive-block interactive-slider">
      <WidgetHeading icon={<SlidersHorizontal size={16} />} title={widget.title} description={widget.description} />
      <div className="slider-value-row">
        <span>{widget.label}</span>
        <strong>{value}{widget.unit || ""}</strong>
      </div>
      <input
        type="range"
        min={widget.min}
        max={widget.max}
        step={safeStep}
        value={value}
        aria-label={widget.label}
        style={{ "--slider-progress": `${progress}%` } as React.CSSProperties}
        onChange={(event) => setValue(Number(event.target.value))}
      />
      <div className="slider-bounds">
        <span>{widget.min}{widget.unit || ""}</span>
        <span>{widget.max}{widget.unit || ""}</span>
      </div>
      {feedback && (
        <div className="slider-feedback">
          <Gauge size={15} />
          <span>
            <strong>{feedback.label}</strong>
            {feedback.description && <small>{feedback.description}</small>}
          </span>
        </div>
      )}
    </section>
  );
}

function BarsView({ widget }: { widget: BarsWidget }) {
  const initial = widget.items.find((item) => item.id === widget.defaultId)?.id || widget.items[0].id;
  const [selectedId, setSelectedId] = useState(initial);
  const selected = widget.items.find((item) => item.id === selectedId) || widget.items[0];
  const commonMax = Math.max(1, ...widget.items.map((item) => item.max || Math.abs(item.value)));

  return (
    <section className="interactive-block interactive-bars">
      <WidgetHeading icon={<BarChart3 size={16} />} title={widget.title} description={widget.description} />
      <div className="bar-list">
        {widget.items.map((item) => {
          const max = item.max && item.max > 0 ? item.max : commonMax;
          const width = Math.min(100, Math.max(0, (Math.abs(item.value) / max) * 100));
          const active = item.id === selected.id;
          return (
            <button
              type="button"
              className={`bar-row ${active ? "active" : ""}`}
              key={item.id}
              aria-pressed={active}
              onClick={() => setSelectedId(item.id)}
            >
              <span className="bar-label">{item.label}</span>
              <span className="bar-track"><span style={{ width: `${width}%` }} /></span>
              <strong>{item.value}{item.unit || ""}</strong>
            </button>
          );
        })}
      </div>
      <p className="interactive-summary">
        <span>{selected.label}：{selected.value}{selected.unit || ""}</span>
        {selected.detail || "点击其他项目查看对应数值。"}
      </p>
    </section>
  );
}

function StepsView({ widget }: { widget: StepsWidget }) {
  const initial = Math.min(widget.steps.length - 1, Math.max(0, (widget.current ?? 1) - 1));
  const [current, setCurrent] = useState(initial);
  const step = widget.steps[current];
  const progress = ((current + 1) / widget.steps.length) * 100;

  return (
    <section className="interactive-block interactive-steps">
      <WidgetHeading icon={<ListChecks size={16} />} title={widget.title} description={widget.description} />
      <div className="step-status">
        <strong>第 {current + 1} 步：{step.label}</strong>
        <span>{current + 1} / {widget.steps.length}</span>
      </div>
      <div className="step-track" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <div className="step-labels">
        {widget.steps.map((item, index) => (
          <button
            type="button"
            className={index === current ? "active" : index < current ? "done" : ""}
            key={`${item.label}-${index}`}
            onClick={() => setCurrent(index)}
          >
            <span>{index < current ? <Check size={11} /> : index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
      {step.description && <p className="interactive-summary">{step.description}</p>}
      <div className="step-actions">
        <button type="button" disabled={current === 0} onClick={() => setCurrent((value) => Math.max(0, value - 1))}>
          <ArrowLeft size={14} />
          上一步
        </button>
        <button type="button" className="primary" disabled={current === widget.steps.length - 1} onClick={() => setCurrent((value) => Math.min(widget.steps.length - 1, value + 1))}>
          下一步
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

function InteractiveBlock({ widget }: { widget: InteractiveWidget }) {
  if (widget.type === "choice") return <ChoiceView widget={widget} />;
  if (widget.type === "slider") return <SliderView widget={widget} />;
  if (widget.type === "bars") return <BarsView widget={widget} />;
  return <StepsView widget={widget} />;
}

export function InteractiveMessage({ content }: { content: string }) {
  const segments = useMemo(() => parseInteractiveMessage(content), [content]);
  return (
    <div className="message-content">
      {segments.map((segment, index) => segment.kind === "widget" ? (
        <InteractiveBlock widget={segment.widget} key={`widget-${index}`} />
      ) : segment.content.trim() ? (
        <div className="markdown-content" key={`markdown-${index}`}>
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={[remarkGfm, remarkMath, remarkAutoSpace]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={markdownUrlTransform}
          >{segment.content}</ReactMarkdown>
        </div>
      ) : null)}
    </div>
  );
}
