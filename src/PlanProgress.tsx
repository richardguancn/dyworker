import { Check, ChevronDown, Circle, ListTodo, LoaderCircle } from 'lucide-react';
import type { ChatMessage, PlanStep } from './types';
import { planProgress } from './planProgressState';

function PlanSteps({ steps, archived = false }: { steps: PlanStep[]; archived?: boolean }) {
  return (
    <ol className="plan-progress-steps">
      {steps.map((step, index) => (
        <li className={`plan-progress-step ${step.status}`} key={index}>
          {step.status === 'completed' ? <Check size={14} aria-label="已完成" />
            : step.status === 'in_progress' && !archived ? <LoaderCircle size={14} className="spin" aria-label="进行中" />
              : <Circle size={12} aria-label={step.status === 'in_progress' ? '结束时进行中' : '待完成'} />}
          <span>{step.title}</span>
        </li>
      ))}
    </ol>
  );
}

// 保存结束时的实际状态；停止或失败不会把未完成的步骤标记为完成。
export function ArchivedPlan({ steps }: { steps: PlanStep[] }) {
  const completed = steps.filter(step => step.status === 'completed').length;
  return (
    <section className="process-plan" aria-label="工作计划记录">
      <div className="process-plan-heading">
        <ListTodo size={14} aria-hidden="true" />
        <strong>工作计划</strong>
        <span>{completed}/{steps.length} 已完成</span>
      </div>
      <PlanSteps steps={steps} archived />
    </section>
  );
}

export function PlanProgress({ running, message }: { running: boolean; message?: ChatMessage }) {
  const progress = planProgress(running, message);
  if (!progress) return null;
  return (
    <details className="plan-progress" aria-label="工作计划进度" key={message?.id || message?.createdAt}>
      <summary className="plan-progress-toggle" title="展开或收起工作计划">
        <div className="plan-progress-summary">
          <ListTodo size={14} aria-hidden="true" />
          <span className="plan-progress-title" title={progress.title}>{progress.title}</span>
          <span className="plan-progress-count">{progress.completed}/{progress.total} 已完成</span>
          <ChevronDown className="plan-progress-chevron" size={13} aria-hidden="true" />
        </div>
        <div className="plan-progress-track" role="progressbar" aria-label="工作计划"
          aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}
          aria-valuetext={`${progress.completed}/${progress.total} 已完成：${progress.title}`}>
          <div className="plan-progress-fill" style={{ width: `${progress.percent}%` }} />
        </div>
      </summary>
      <div className="plan-progress-details">
        <strong>工作计划</strong>
        <PlanSteps steps={message!.plan!} />
      </div>
    </details>
  );
}
