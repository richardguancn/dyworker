// 挂起 / 唤醒说明文案的纯函数。
//
// 气泡里那句「将于 X 自动唤醒继续（原因：R）」是我们自己生成的将来时。续跑真的开跑、
// 收尾、或重启后发现那一觉早已走完时都必须改口，否则界面会一边写着"将于 15:05:02
// 自动唤醒"，一边已经跑了 3 分钟（线上截图事故）。抽成纯函数是为了直接单测这些改写。

/** 到点自动唤醒的时间展示：非法/缺失时间戳退回"到点"，不要显示 Invalid Date */
export function formatWakeTime(wakeAt: string) {
  const timestamp = new Date(String(wakeAt || "")).getTime();
  if (!Number.isFinite(timestamp)) return "到点";
  return new Date(timestamp).toLocaleString("zh-CN");
}

/**
 * 唤醒开跑：把将来时的挂起说明换成 marker（"已于 X 到点自动唤醒，正在继续处理…"
 * 或"已按你的要求立即继续处理…"），并去掉已经不适用的"到点会照常继续"。
 * 两种句式都要认：尚未收口的"将于 X 自动唤醒继续"、已收口的"原定 X 自动唤醒"。
 * 匹配不到（不是这条挂起说明）时原样返回。
 */
export function rephraseSleepNote(content: string, wakeAtText: string, marker: string) {
  const claims = [
    `将于 ${wakeAtText} 自动唤醒继续（原因：`,
    `原定 ${wakeAtText} 自动唤醒（原因：`,
  ];
  const claim = claims.find((item) => content.includes(item));
  if (!claim) return content;
  const start = content.indexOf(claim);
  const end = content.indexOf("）。", start);
  if (end < 0) return content;
  const reason = content.slice(start + claim.length, end);
  return `${content.slice(0, start)}${marker}（原因：${reason}）${content.slice(end + 2)}`
    .replace(/期间可以关闭应用，到点会照常继续。?/g, "")
    .trim();
}

/**
 * 续跑进行中 / 已收尾两种说法。到点自动唤醒与用户点「立即继续」不能混为一谈
 * （后者说成"已到点自动唤醒"是在编故事），所以文案成对给出：
 * marker 写进气泡表示"正在继续处理"，收尾时整体换成 done。
 */
export function wakingNoteTexts(wakeAtText: string, manual: boolean) {
  return manual
    ? { marker: "已按你的要求立即继续处理…", done: "已按你的要求立即继续处理。" }
    : {
        marker: `已于 ${wakeAtText} 到点自动唤醒，正在继续处理…`,
        done: `已于 ${wakeAtText} 到点自动唤醒并继续处理。`,
      };
}

/** 续跑收尾：把进行时的 marker 换成完成时的说法；重复调用幂等 */
export function closeWakingNote(content: string, marker: string, done: string) {
  if (!content.includes(marker)) return content;
  return content.replace(marker, done);
}

/**
 * 这一觉已经走完（到点跑过、被用户取消、或窗口关着时已触发）：
 * 将来时改成"原定 X 自动唤醒"，避免历史消息继续声称将来会唤醒。
 */
export function settleResolvedSleepNote(content: string) {
  if (!content.includes(" 自动唤醒继续（原因：")) return content;
  return content
    .replace(/将于 ([\s\S]*?) 自动唤醒继续（原因：/g, "原定 $1 自动唤醒（原因：")
    .replace(/期间可以关闭应用，到点会照常继续。?/g, "")
    .trim();
}
