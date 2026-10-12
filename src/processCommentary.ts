import type { ActivityRecord, ChatMessage } from "./types";

/**
 * 任务执行中，模型某一轮的文字会同时落到两个地方，界面上就会重复显示同一段话：
 *   1. 该轮思考活动的 commentary —— 过程流里按发生顺序平铺的说明段落；
 *   2. 消息正文 —— assistant-text 事件只携带「本轮」的累积文字，正文区显示的正是同一段说明。
 * （收尾时正文会被最终答复覆盖，所以只在这种"正文就是过程流里那段说明"的执行中出现。）
 *
 * 这里判断正文是不是过程流里已经展示过的那段说明；是的话正文区不再重复渲染，
 * 说明只在过程流里出现一次。
 */
export function contentEchoesProcessCommentary(
  message: Pick<ChatMessage, "content" | "activities">,
  options: { streaming: boolean },
): boolean {
  if (!options.streaming) return false;
  const content = (message.content || "").trim();
  if (!content) return false;
  // 只看主活动流：子代理分支（children）里的说明与正文无关，不能拿来判定重复
  return (message.activities || []).some((activity: ActivityRecord) => {
    const commentary = (activity.commentary || "").trim();
    return Boolean(commentary) && commentary === content;
  });
}
