import { useCallback, useMemo, useRef, useState } from "react";
import { contextUsageSummary, formatTokenCount } from "../../contextUsage";
import { TokenActivity } from "../../TokenActivityPanel";
import type { UsageRecord } from "../../types";

// 上下文用量圆环：当前会话已用标记 / 当前模型上下文上限；tooltip 附带会话累计 token 用量
export function ContextRing({ used, limit, exact, stats }: {
  used: number;
  limit: number;
  exact?: boolean;
  stats?: { prompt: number; completion: number; requests: number } | null;
}) {
  const summary = contextUsageSummary(used, limit);
  const { ratio, percent } = summary;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const level = ratio >= 0.95 ? "danger" : ratio >= 0.8 ? "warn" : "ok";
  const ringRef = useRef<HTMLSpanElement | null>(null);
  // 圆环在输入框左侧工具组的最右边，气泡默认向左展开会超出输入框、被侧栏盖住。
  // 弹出前量一次可用空间：朝余量大的一侧展开，并把最大宽度收到输入框内边距之间，
  // 内容长时换成多行，而不是溢出到别的面板后面。
  const [placement, setPlacement] = useState<{ side: "left" | "right"; maxWidth: number } | null>(null);
  const placeTooltip = useCallback(() => {
    const ring = ringRef.current;
    const card = ring?.closest(".composer-card") as HTMLElement | null;
    if (!ring || !card) return;
    const ringBox = ring.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const cardStyle = getComputedStyle(card);
    const inset = (value: string) => Number.parseFloat(value) || 0;
    const contentLeft = cardBox.left + inset(cardStyle.borderLeftWidth) + inset(cardStyle.paddingLeft);
    const contentRight = cardBox.right - inset(cardStyle.borderRightWidth) - inset(cardStyle.paddingRight);
    const roomLeft = Math.max(0, ringBox.left - contentLeft);
    const roomRight = Math.max(0, contentRight - ringBox.right);
    const side: "left" | "right" = roomRight >= roomLeft ? "right" : "left";
    // 朝该侧展开时可用宽度 = 该侧余量 + 圆环自身宽度 + 气泡越过圆环边缘的 6px；
    // 空间实在不够时保底 180px，宁可轻微越界也不把整段文字挤成一列
    const room = (side === "right" ? roomRight : roomLeft) + ringBox.width + 6;
    setPlacement({ side, maxWidth: Math.max(180, Math.min(320, Math.round(room))) });
  }, []);
  return (
    <span
      className={`context-ring ${level}`}
      ref={ringRef}
      tabIndex={0}
      onMouseEnter={placeTooltip}
      onFocus={placeTooltip}
      aria-label={`上下文窗口：${summary.percentLabel} 已用，已用 ${summary.usedLabel} 标记，共 ${summary.limitLabel}`}
    >
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r={radius} fill="none" strokeWidth="2.5" className="context-ring-track" />
        <circle
          cx="11"
          cy="11"
          r={radius}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="context-ring-value"
          strokeDasharray={`${(ratio * circumference).toFixed(1)} ${circumference.toFixed(1)}`}
          transform="rotate(-90 11 11)"
        />
      </svg>
      <span className="context-ring-text">{percent === 0 && used > 0 ? "<1%" : `${percent}%`}</span>
      {stats && stats.requests > 0 && (
        <span className="context-ring-tokens">
          {formatTokenCount(stats.prompt + stats.completion)}
        </span>
      )}
      <span
        className="context-ring-tooltip"
        role="tooltip"
        style={placement
          ? {
            maxWidth: `${placement.maxWidth}px`,
            left: placement.side === "right" ? "-6px" : "auto",
            right: placement.side === "right" ? "auto" : "-6px",
          }
          : undefined}
      >
        <span className="context-tip-head">
          <span className="context-tip-title">上下文窗口</span>
          <strong className={`context-tip-percent ${level}`}>{summary.percentLabel} 已用</strong>
        </span>
        <span className="context-tip-line">已用 {summary.usedLabel} 标记，共 {summary.limitLabel}</span>
        {stats && stats.requests > 0 && (
          <>
            <span className="context-tip-line">本会话累计 {stats.requests} 次请求</span>
            <span className="context-tip-line">输入 {formatTokenCount(stats.prompt)} · 输出 {formatTokenCount(stats.completion)} tokens</span>
          </>
        )}
        {!exact && <small className="context-tip-note">当前为估算值，发送任务后按服务返回值更新</small>}
      </span>
    </span>
  );
}

export interface ModelUsageSummary {
  requests: number;
  prompt: number;
  completion: number;
  estimated: number;
  todayPrompt: number;
  todayCompletion: number;
}

export function UsageStatsPanel({ records }: { records: UsageRecord[] | null }) {
  const summary = useMemo(() => {
    const today = new Date().toDateString();
    const byModel = new Map<string, ModelUsageSummary>();
    for (const record of records || []) {
      const entry = byModel.get(record.model) || { requests: 0, prompt: 0, completion: 0, estimated: 0, todayPrompt: 0, todayCompletion: 0 };
      entry.requests += 1;
      entry.prompt += record.prompt;
      entry.completion += record.completion;
      if (record.estimated) entry.estimated += 1;
      if (new Date(record.time).toDateString() === today) {
        entry.todayPrompt += record.prompt;
        entry.todayCompletion += record.completion;
      }
      byModel.set(record.model, entry);
    }
    return [...byModel.entries()].sort((a, b) => (b[1].prompt + b[1].completion) - (a[1].prompt + a[1].completion));
  }, [records]);
  const totals = summary.reduce((sum, [, entry]) => ({
    requests: sum.requests + entry.requests,
    prompt: sum.prompt + entry.prompt,
    completion: sum.completion + entry.completion,
    today: sum.today + entry.todayPrompt + entry.todayCompletion,
  }), { requests: 0, prompt: 0, completion: 0, today: 0 });

  return (
    <>
      {records !== null && <TokenActivity records={records} />}
      {records === null ? (
          <p className="dialog-note">正在读取…</p>
        ) : summary.length === 0 ? (
          <p className="dialog-note">还没有用量记录。发送任务后，每次模型调用的 token 用量会按模型累计在这里。</p>
        ) : (
          <>
            <p className="dialog-note">
              今日 {formatTokenCount(totals.today)} tokens · 累计 {totals.requests} 次请求，输入 {formatTokenCount(totals.prompt)} + 输出 {formatTokenCount(totals.completion)} = {formatTokenCount(totals.prompt + totals.completion)} tokens
            </p>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>请求</th>
                  <th>输入</th>
                  <th>输出</th>
                  <th>合计</th>
                  <th>今日</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(([model, entry]) => (
                  <tr key={model}>
                    <td className="usage-model">{model}</td>
                    <td>{entry.requests}</td>
                    <td>{formatTokenCount(entry.prompt)}</td>
                    <td>{formatTokenCount(entry.completion)}</td>
                    <td>{formatTokenCount(entry.prompt + entry.completion)}</td>
                    <td>{formatTokenCount(entry.todayPrompt + entry.todayCompletion)}</td>
                    <td>{entry.estimated > 0 ? `含 ${entry.estimated} 次估算` : "实测"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dialog-note">标注「估算」的记录来自不回 usage 的端点，按中文 1 token、其他字符约 4 个 1 token 估算；实测记录以端点返回的 usage 为准。</p>
          </>
        )}
    </>
  );
}
