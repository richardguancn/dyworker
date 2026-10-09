import type { ChatMessage } from './types.ts';

// 思考流属于当前轮活动；同步写入活动详情，避免被状态提示遮挡，或串到已完成的轮次。
export function applyReasoningStream(message: ChatMessage, text: string): ChatMessage {
  const activities = message.activities;
  let index = -1;
  for (let offset = (activities?.length ?? 0) - 1; offset >= 0; offset -= 1) {
    if (activities![offset].kind === 'thinking' && activities![offset].status === 'running') {
      index = offset;
      break;
    }
  }
  return {
    ...message,
    reasoning: text,
    ...(activities && index >= 0 ? {
      activities: activities.map((activity, offset) => offset === index ? { ...activity, detail: text } : activity),
    } : {}),
  };
}
