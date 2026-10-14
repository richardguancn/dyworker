import { ListTodo } from 'lucide-react';
import type { ChatMessage } from './types';
import { planProgress } from './planProgressState';

export function PlanProgress({ running, message }: { running: boolean; message?: ChatMessage }) {
  const progress = planProgress(running, message);
  if (!progress) return null;
  return (
    <div className="plan-progress" aria-label="工作计划进度">
      <div className="plan-progress-summary">
        <ListTodo size={14} aria-hidden="true" />
        <span className="plan-progress-title" title={progress.title}>{progress.title}</span>
        <span className="plan-progress-count">{progress.completed}/{progress.total} 已完成</span>
      </div>
      <div className="plan-progress-track" role="progressbar" aria-label="工作计划"
        aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}
        aria-valuetext={`${progress.completed}/${progress.total} 已完成：${progress.title}`}>
        <div className="plan-progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
