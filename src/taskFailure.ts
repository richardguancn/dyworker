import type { ChatMessage } from './types.ts';

/** 返回失败和结束事件可以先后抵达；始终归并到这次请求自己的回复。 */
export function recordTaskFailure(messages: ChatMessage[], failure: {
  assistantId?: string; runId: string; detail: string; createdAt: string;
}): ChatMessage[] {
  const index = failure.assistantId ? messages.findIndex(message => message.id === failure.assistantId) : -1;
  if (index < 0) return [...messages, { role: 'assistant', runId: failure.runId, taskStatus: 'error',
    content: `请求没有完成：${failure.detail}`, createdAt: failure.createdAt }];
  const current = messages[index];
  if (current.taskStatus && current.taskStatus !== 'queued') return messages;
  return messages.map((message, at) => at === index ? { ...message, taskStatus: 'error',
    content: message.content ? `${message.content}\n\n请求没有完成：${failure.detail}` : `请求没有完成：${failure.detail}`,
    createdAt: failure.createdAt } : message);
}
