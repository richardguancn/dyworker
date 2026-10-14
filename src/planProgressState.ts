import type { ChatMessage } from './types';

// 只读当前运行轮次，不能把上一轮的计划带到新的输入框上。
export function planProgress(running: boolean, message?: ChatMessage) {
  if (!running || message?.role !== 'assistant' || message.taskStatus || !message.plan?.length) return null;
  const steps = message.plan;
  const completed = steps.filter(step => step.status === 'completed').length;
  const current = steps.find(step => step.status === 'in_progress')
    ?? steps.find(step => step.status !== 'completed');
  return {
    completed, total: steps.length,
    percent: Math.round(completed / steps.length * 100),
    title: current?.title ?? '计划步骤已完成，正在收尾',
  };
}
