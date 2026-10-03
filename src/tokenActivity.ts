// Token 活动图的纯数据模型：把逐条用量记录按本地日聚合，再派生出每天热力图、每周方块柱与累计总量三种视图。
// 只含纯函数（不碰 DOM），供 TokenActivity 组件与 node --test 直接复用。
import type { UsageRecord } from "./types";

export interface DayActivity {
  key: string; // YYYY-MM-DD（本地时区）
  date: Date;
  tokens: number;
}

export interface WeekActivity {
  start: Date; // 周日
  days: DayActivity[]; // 恒 7 天，从周日到周六
  tokens: number;
  cumulative: number; // 含本周在内的自窗口起点累计
}

export interface TokenActivityData {
  weeks: WeekActivity[]; // 恒 53 周，以当前周收尾
  maxDay: number;
  maxWeek: number;
  total: number;
  dayLevels: number[]; // 与 weeks 的天一一对应的颜色档位 0-4
  weeklyBlocks: number[]; // 每周的方块数 0-8
  cumulativeBlocks: number[]; // 累计口径的方块数 0-8
}

/** 每周/累计方块柱的最大高度（块数） */
export const MAX_BLOCKS = 8;

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 周从周日开始（GitHub 惯例）：返回该日所在周的周日零点 */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  day.setDate(day.getDate() - day.getDay());
  return day;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 按非零值的分位数（40%/70%/90%）划 4 档，避免单日尖峰把其余日子全压成最浅档 */
function computeDayThresholds(nonZero: number[]): [number, number, number] {
  if (nonZero.length === 0) return [1, 2, 3];
  const sorted = [...nonZero].sort((a, b) => a - b);
  const pick = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  return [pick(0.4), pick(0.7), pick(0.9)];
}

export function aggregateTokenActivity(records: UsageRecord[], today = new Date()): TokenActivityData {
  const byDay = new Map<string, number>();
  for (const record of records || []) {
    const tokens = (record.prompt || 0) + (record.completion || 0);
    if (!(tokens > 0)) continue;
    const key = dayKey(new Date(record.time));
    byDay.set(key, (byDay.get(key) || 0) + tokens);
  }

  const thisWeek = startOfWeek(today);
  const firstWeek = addDays(thisWeek, -52 * 7);
  const weeks: WeekActivity[] = [];
  const nonZeroDays: number[] = [];
  let cumulative = 0;
  let maxDay = 0;

  for (let w = 0; w < 53; w += 1) {
    const start = addDays(firstWeek, w * 7);
    const days: DayActivity[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = addDays(start, d);
      const tokens = byDay.get(dayKey(date)) || 0;
      if (tokens > 0) nonZeroDays.push(tokens);
      if (tokens > maxDay) maxDay = tokens;
      days.push({ key: dayKey(date), date, tokens });
    }
    const tokens = days.reduce((sum, day) => sum + day.tokens, 0);
    cumulative += tokens;
    weeks.push({ start, days, tokens, cumulative });
  }

  const thresholds = computeDayThresholds(nonZeroDays);
  const dayLevels = weeks.flatMap((week) =>
    week.days.map((day) => {
      if (!(day.tokens > 0)) return 0;
      if (day.tokens > thresholds[2]) return 4;
      if (day.tokens > thresholds[1]) return 3;
      if (day.tokens > thresholds[0]) return 2;
      return 1;
    }),
  );

  const maxWeek = weeks.reduce((max, week) => Math.max(max, week.tokens), 0);
  const total = weeks.reduce((sum, week) => sum + week.tokens, 0);
  const finalCumulative = weeks.length > 0 ? weeks[weeks.length - 1].cumulative : 0;

  return {
    weeks,
    maxDay,
    maxWeek,
    total,
    dayLevels,
    weeklyBlocks: weeks.map((week) => blockCount(week.tokens, maxWeek)),
    cumulativeBlocks: weeks.map((week) => blockCount(week.cumulative, finalCumulative)),
  };
}

/** 值按比例折成 1-8 块（0 值或无可比基准时为 0 = 空柱） */
export function blockCount(value: number, maxValue: number): number {
  if (!(value > 0) || !(maxValue > 0)) return 0;
  return Math.max(1, Math.min(MAX_BLOCKS, Math.round((value / maxValue) * MAX_BLOCKS)));
}

/** 中文口径的 token 数：亿/万保留一位小数并去掉尾零（5455.7万、3亿、32.3亿） */
export function formatTokenCN(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1e8) return `${trimOneDecimal(tokens / 1e8)}亿`;
  if (tokens >= 1e4) return `${trimOneDecimal(tokens / 1e4)}万`;
  return String(Math.round(tokens));
}

function trimOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 提示框首行：每天 = 「6月1日」 */
export function dailyTooltipTitle(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 提示框首行：每周 = 「2026年6月1日 起的一周」 */
export function weeklyTooltipTitle(start: Date): string {
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 起的一周`;
}

/** 提示框首行：累计总量 = 「累计至 2026年6月21日 起的一周」 */
export function cumulativeTooltipTitle(start: Date): string {
  return `累计至 ${weeklyTooltipTitle(start)}`;
}
