import type { ReactNode } from 'react';
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

export function PlanProgress({ running, message, goal }: { running: boolean; message?: ChatMessage; goal?: ReactNode }) {
  const progress = planProgress(running, message);
  if (!progress && !goal) return null;
  return (
    <div className="plan-progress">
      {goal}
      {progress && <details className="plan-progress-plan" aria-label="工作计划进度" key={message?.id || message?.createdAt}>
        <summary className="plan-progress-toggle" title="展开或收起工作计划">
          <div className="plan-progress-summary">
            <ListTodo size={14} aria-hidden="true" />
            <span className="plan-progress-title" title={progress.title}>{progress.title}</span>
            <span className="plan-progress-meter" role="progressbar" aria-label="工作计划"
              aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}
              aria-valuetext={`${progress.completed}/${progress.total} 已完成：${progress.title}`}>
              <svg className="plan-progress-ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <circle className="plan-progress-ring-track" cx="10" cy="10" r="7.25" fill="none" strokeWidth="2" />
                {progress.completed > 0 && <circle className="plan-progress-ring-value" cx="10" cy="10" r="7.25"
                  fill="none" strokeWidth="2" pathLength="100" strokeDasharray="100"
                  strokeDashoffset={100 - progress.completed / progress.total * 100} transform="rotate(-90 10 10)" />}
                {progress.completed === progress.total
                  ? <path className="plan-progress-ring-check" d="m6.75 10 2.25 2.25 4.25-4.5" fill="none" strokeWidth="1.5" />
                  : message!.plan!.some(step => step.status === 'in_progress') && <circle className="plan-progress-ring-active" cx="10" cy="10" r="1.75" />}
              </svg>
              <span className="plan-progress-count">{progress.completed}/{progress.total} 已完成</span>
            </span>
            <ChevronDown className="plan-progress-chevron" size={13} aria-hidden="true" />
          </div>
        </summary>
        <div className="plan-progress-details">
          <PlanSteps steps={message!.plan!} />
        </div>
      </details>}
    </div>
  );
}
