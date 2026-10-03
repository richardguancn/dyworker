// 挂起/唤醒说明文案的行为契约。
// 事故背景：任务 15:02 主动挂起（约定 15:05:02 唤醒），15:05 到点续跑已经跑起来了，
// 界面却还写着"将于 15:05:02 自动唤醒继续"，下面配一句泛泛的"正在处理任务"。
import test from "node:test";
import assert from "node:assert/strict";
import { closeWakingNote, formatWakeTime, rephraseSleepNote, settleResolvedSleepNote, wakingNoteTexts } from "../src/wakeNote.ts";

// 与 App.tsx 生成侧逐字一致的挂起说明（桌面会话）
const SLEEPING_CONTENT = [
  "文章编辑器需要视频转码完成后才能插入。先等转码（3 分钟后检查）：",
  "",
  "**已主动挂起**：将于 2026/10/2 15:05:02 自动唤醒继续（原因：等待公众号后台对上传的 123 秒视频完成转码，以便插入文章形成视频文章草稿）。期间可以关闭应用，到点会照常继续。",
].join("\n");

const WAKE_AT = "2026-10-02T15:05:02.000+08:00";
const WAKE_AT_TEXT = formatWakeTime(WAKE_AT);

test("formatWakeTime：本地时间展示；非法/缺失时间戳退回「到点」而不是 Invalid Date", () => {
  assert.equal(formatWakeTime(WAKE_AT), new Date(WAKE_AT).toLocaleString("zh-CN"));
  assert.equal(formatWakeTime(""), "到点");
  assert.equal(formatWakeTime("不是时间"), "到点");
  assert.equal(formatWakeTime(undefined), "到点");
});

test("rephraseSleepNote：续跑开跑后把将来时改成进行时，并清掉「到点会照常继续」", () => {
  const marker = `已于 ${WAKE_AT_TEXT} 到点自动唤醒，正在继续处理…`;
  const next = rephraseSleepNote(SLEEPING_CONTENT, WAKE_AT_TEXT, marker);
  assert.ok(next.includes(marker), "应改成进行时");
  assert.ok(next.includes("（原因：等待公众号后台对上传的 123 秒视频完成转码，以便插入文章形成视频文章草稿）"), "原因要原样保留");
  assert.ok(!next.includes("将于"), "不能再留将来时");
  assert.ok(!next.includes("到点会照常继续"), "已经开跑了就不该再说会到点继续");
  // 正文头部不受影响
  assert.ok(next.startsWith("文章编辑器需要视频转码完成后才能插入。先等转码（3 分钟后检查）："));
});

test("rephraseSleepNote：手动「立即继续」用另一种说法；匹配不到时原样返回", () => {
  const manual = rephraseSleepNote(SLEEPING_CONTENT, WAKE_AT_TEXT, "已按你的要求立即继续处理…");
  assert.ok(manual.includes("已按你的要求立即继续处理…（原因："));
  assert.ok(!manual.includes("自动唤醒继续"));

  // 时间对不上（不是这一轮的挂起说明）不动
  assert.equal(rephraseSleepNote(SLEEPING_CONTENT, "2026/10/2 16:00:00", "x…"), SLEEPING_CONTENT);
  // 普通正文不动
  const plain = "普通回复，没有任何挂起说明。";
  assert.equal(rephraseSleepNote(plain, WAKE_AT_TEXT, "x…"), plain);
  // 说明被截断（没有结尾括号）时不动，避免啃掉正文
  const broken = "**已主动挂起**：将于 2026/10/2 15:05:02 自动唤醒继续（原因：没写完";
  assert.equal(rephraseSleepNote(broken, WAKE_AT_TEXT, "x…"), broken);
});

test("wakingNoteTexts + closeWakingNote：进行时/完成时成对，收口幂等", () => {
  const auto = wakingNoteTexts(WAKE_AT_TEXT, false);
  assert.equal(auto.marker, `已于 ${WAKE_AT_TEXT} 到点自动唤醒，正在继续处理…`);
  assert.equal(auto.done, `已于 ${WAKE_AT_TEXT} 到点自动唤醒并继续处理。`);
  // 手动「立即继续」不能说成"已到点自动唤醒"
  const manual = wakingNoteTexts(WAKE_AT_TEXT, true);
  assert.ok(!manual.marker.includes("自动唤醒") && !manual.done.includes("自动唤醒"));

  const awake = rephraseSleepNote(SLEEPING_CONTENT, WAKE_AT_TEXT, auto.marker);
  const done = closeWakingNote(awake, auto.marker, auto.done);
  assert.ok(done.includes(`${auto.done}（原因：`), "收口为完成时态");
  assert.ok(!done.includes("正在继续处理"));
  assert.equal(closeWakingNote(done, auto.marker, auto.done), done, "再收一次不应有变化");
});

test("settleResolvedSleepNote：这一觉已经走完的旧消息不再声称将来会唤醒", () => {
  const settled = settleResolvedSleepNote(SLEEPING_CONTENT);
  assert.ok(settled.includes(`原定 ${WAKE_AT_TEXT} 自动唤醒（原因：`));
  assert.ok(!settled.includes("将于"));
  assert.ok(!settled.includes("到点会照常继续"));
  // 已收口过的消息不重复改写（幂等）
  assert.equal(settleResolvedSleepNote(settled), settled);
  // 唤醒续跑再次挂起的句式（主进程 collector 生成）同样收口
  const resleep = "进展到这里。\n\n已再次挂起，将于 2026/10/2 15:20:00 自动唤醒继续（原因：等转码）。";
  assert.ok(settleResolvedSleepNote(resleep).includes("原定 2026/10/2 15:20:00 自动唤醒（原因：等转码）。"));
  // 没有挂起说明的正文不动
  assert.equal(settleResolvedSleepNote("普通回复"), "普通回复");
});

test("文案改写不碰模型正文：只有我们生成的那句会变", () => {
  const content = "模型正文里也提到过将于明天上线（这句不是我们生成的）。\n\n**已主动挂起**：将于 2026/10/2 15:05:02 自动唤醒继续（原因：等转码）。";
  const settled = settleResolvedSleepNote(content);
  assert.ok(settled.includes("模型正文里也提到过将于明天上线（这句不是我们生成的）。"), "模型正文必须原样保留");
  assert.ok(settled.includes("原定 2026/10/2 15:05:02 自动唤醒（原因：等转码）。"));
});
