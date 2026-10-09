import { useEffect, useState } from 'react';
import { Check, Maximize2, Minimize2, PauseCircle, PlayCircle, Target, Trash2 } from 'lucide-react';
import type { SessionRecord } from './types';
import { goalDuration, goalElapsed } from './goal';

export function GoalBanner({ session, busy, onAction }: {
  session: SessionRecord;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'remove' | 'complete') => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const status = session.goalState?.status || 'active';
  useEffect(() => {
    if (status !== 'active') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status, session.goalState?.id]);
  const run = async (action: Parameters<typeof onAction>[0]) => {
    if (pending) return;
    setPending(true);
    try { await onAction(action); } finally { setPending(false); }
  };
  const label = { active: '进行中的目标', paused: '已暂停的目标', blocked: '待继续的目标', complete: '已完成的目标' }[status];
  return <section className={`goal-banner${expanded ? ' expanded' : ''}`} aria-label="会话目标">
    <div className="goal-banner-row">
      <Target size={16} className="goal-banner-icon" aria-hidden />
      <button type="button" className="goal-banner-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={`goal-details-${session.id}`} title={session.goal}>
        <strong className="goal-banner-label">{label}</strong>
        <span className="goal-banner-text">{session.goal}</span>
      </button>
      <span className="goal-banner-time" aria-label={`累计用时 ${goalDuration(goalElapsed(session, now))}`}>· {goalDuration(goalElapsed(session, now))}</span>
      <div className="goal-banner-actions">
        <button type="button" disabled={pending} onClick={() => void run('remove')} aria-label="删除目标" title="删除目标"><Trash2 size={15} /></button>
        {status !== 'complete' && <button type="button" disabled={pending || (status !== 'active' && busy)} onClick={() => void run(status === 'active' ? 'pause' : 'resume')}
          aria-label={status === 'active' ? '暂停目标' : '继续目标'} title={status === 'active' ? '暂停目标' : busy ? '当前任务结束后可继续目标' : '继续目标'}>
          {status === 'active' ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
        </button>}
        <button type="button" onClick={() => setExpanded(!expanded)} aria-label={expanded ? '收起目标详情' : '展开目标详情'} aria-expanded={expanded} aria-controls={`goal-details-${session.id}`} title={expanded ? '收起目标详情' : '展开目标详情'}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
    {expanded && <div className="goal-banner-details" id={`goal-details-${session.id}`}>
      <p>{session.goal}</p>
      {session.goalState?.reason && <p className="goal-banner-reason">{session.goalState.reason}</p>}
      <div className="goal-banner-detail-footer">
        <span>{status === 'active' ? '每次最多自动推进 10 轮，完成后停止；暂停期间不继续计时。' : status === 'complete' ? '目标已完成，不再用于后续任务。' : '继续后会接着已有进展推进。'}</span>
        {status !== 'complete' && <button type="button" className="goal-banner-done" disabled={pending} onClick={() => void run('complete')}><Check size={14} />标记完成</button>}
      </div>
    </div>}
  </section>;
}
