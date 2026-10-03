import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateTokenActivity,
  blockCount,
  cumulativeTooltipTitle,
  dailyTooltipTitle,
  dayKey,
  formatTokenCN,
  MAX_BLOCKS,
  weeklyTooltipTitle,
} from "../src/tokenActivity.ts";

function recordAt(iso, prompt, completion, model = "test-model") {
  return { time: iso, model, prompt, completion, estimated: false };
}

test("按本地日聚合逐条记录，窗口恒为 53 周且以当前周（周日开头）收尾", () => {
  const today = new Date(2026, 9, 3); // 周六
  const data = aggregateTokenActivity(
    [
      recordAt("2026-10-01T10:00:00", 1000, 500),
      recordAt("2026-10-01T18:00:00", 300, 200),
      recordAt("2026-09-30T08:00:00", 400, 100),
    ],
    today,
  );
  assert.equal(data.weeks.length, 53);
  for (const week of data.weeks) {
    assert.equal(week.start.getDay(), 0);
    assert.equal(week.days.length, 7);
  }
  assert.equal(dayKey(data.weeks[52].start), "2026-09-27");
  // 10-01 的两笔合并到同一天，10-01 是周四（该周第 5 天）
  assert.equal(data.weeks[52].days[4].tokens, 2000);
  assert.equal(data.weeks[52].tokens, 2500);
  assert.equal(data.total, 2500);
  assert.equal(data.maxWeek, 2500);
  assert.equal(data.maxDay, 2000);
});

test("窗口外的记录不计入总量，累计值沿周单调递增", () => {
  const today = new Date(2026, 9, 3);
  const data = aggregateTokenActivity(
    [
      recordAt("2026-08-10T08:00:00", 100, 50),
      recordAt("2026-08-13T08:00:00", 100, 50),
      recordAt("2020-01-01T00:00:00", 999999, 0),
    ],
    today,
  );
  assert.equal(data.total, 300);
  let last = 0;
  for (const week of data.weeks) {
    assert.ok(week.cumulative >= last);
    last = week.cumulative;
  }
  assert.equal(data.weeks[52].cumulative, 300);
});

test("空记录给出全零且不抛错", () => {
  const data = aggregateTokenActivity([], new Date(2026, 9, 3));
  assert.equal(data.total, 0);
  assert.equal(data.maxWeek, 0);
  assert.deepEqual(data.weeklyBlocks, new Array(53).fill(0));
  assert.deepEqual(data.dayLevels, new Array(371).fill(0));
});

test("每周方块数按周合计比例折算，保底 1 块封顶 8 块", () => {
  const today = new Date(2026, 9, 3);
  const data = aggregateTokenActivity(
    [
      recordAt("2026-09-28T08:00:00", 8000, 0), // 当前周：最大周
      recordAt("2026-09-21T08:00:00", 4000, 0), // 上周：一半
      recordAt("2026-09-14T08:00:00", 50, 0), // 两周前：最低
    ],
    today,
  );
  assert.equal(data.weeklyBlocks[52], MAX_BLOCKS);
  assert.equal(data.weeklyBlocks[51], 4);
  assert.equal(data.weeklyBlocks[50], 1);
});

test("累计方块数对最终累计值归一，后期饱和在 8 块", () => {
  const today = new Date(2026, 9, 3);
  const days = [];
  for (let d = 60; d >= 0; d -= 1) {
    const date = new Date(2026, 9, 3);
    date.setDate(date.getDate() - d);
    days.push(recordAt(date.toISOString(), 10000, 0));
  }
  const data = aggregateTokenActivity(days, today);
  // 最后一周累计=总量 → 满格；越早的周越矮
  assert.equal(data.cumulativeBlocks[52], MAX_BLOCKS);
  assert.ok(data.cumulativeBlocks[52] > data.cumulativeBlocks[0]);
  assert.equal(data.cumulativeBlocks[0], 0); // 窗口首周还没有用量
});

test("每日颜色档位按非零值分位数分布，零值为 0 档", () => {
  const today = new Date(2026, 9, 3);
  const days = [];
  for (let i = 1; i <= 20; i += 1) {
    const date = new Date(2026, 8, i); // 9 月上半月
    days.push(recordAt(date.toISOString(), i * 1000, 0));
  }
  const data = aggregateTokenActivity(days, today);
  const levels = data.dayLevels.filter((level, index) => data.weeks[Math.floor(index / 7)]?.days[index % 7]?.tokens > 0);
  assert.ok(levels.every((level) => level >= 1 && level <= 4));
  assert.ok(new Set(levels).size >= 3, "20 个递增值应落进至少 3 个档位");
  assert.equal(data.dayLevels.filter((level) => level === 0).length, 371 - 20);
});

test("blockCount 边界", () => {
  assert.equal(blockCount(0, 100), 0);
  assert.equal(blockCount(100, 0), 0);
  assert.equal(blockCount(100, 100), MAX_BLOCKS);
  assert.equal(blockCount(1, 1000), 1);
  assert.equal(blockCount(50, 100), 4);
});

test("中文口径格式化：亿/万一位小数并去掉尾零", () => {
  assert.equal(formatTokenCN(54557000), "5455.7万");
  assert.equal(formatTokenCN(300000000), "3亿");
  assert.equal(formatTokenCN(3230000000), "32.3亿");
  assert.equal(formatTokenCN(12345), "1.2万");
  assert.equal(formatTokenCN(9999), "9999");
  assert.equal(formatTokenCN(0), "0");
});

test("提示框标题的三种口径", () => {
  assert.equal(dailyTooltipTitle(new Date(2026, 5, 1)), "6月1日");
  assert.equal(weeklyTooltipTitle(new Date(2026, 5, 1)), "2026年6月1日 起的一周");
  assert.equal(cumulativeTooltipTitle(new Date(2026, 5, 21)), "累计至 2026年6月21日 起的一周");
});
