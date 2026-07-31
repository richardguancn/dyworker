import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  Circle,
  Gauge,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.content}</ReactMarkdown>
        </div>
      ) : null)}
    </div>
  );
}
