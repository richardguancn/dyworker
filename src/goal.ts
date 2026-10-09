import type { AgentResult, SessionRecord } from './types.ts';

export function startGoal(objective: string, now = Date.now()): Pick<SessionRecord, 'goal' | 'goalState'> {
  return { goal: objective.trim(), goalState: { id: crypto.randomUUID(), status: 'active', createdAt: now, elapsedMs: 0, activeSince: now } };
}

export function goalElapsed(session: Pick<SessionRecord, 'goalState'>, now = Date.now()): number {
  const state = session.goalState;
  return Math.max(0, state?.elapsedMs || 0) + (state?.status === 'active' && state.activeSince !== undefined
    ? Math.max(0, now - state.activeSince) : 0);
}

export function goalDuration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ` : ''}${seconds >= 60 ? `${Math.floor(seconds / 60) % 60}m ` : ''}${seconds % 60}s`;
}

export function activeGoal(session: Pick<SessionRecord, 'goal' | 'goalState'>): string | undefined {
  return session.goal && (!session.goalState || session.goalState.status === 'active') ? session.goal : undefined;
}

export function changeGoalStatus(session: SessionRecord, status: NonNullable<SessionRecord['goalState']>['status'], reason?: string, now = Date.now()): SessionRecord {
  if (!session.goal) return session;
  const state = session.goalState || startGoal(session.goal, now).goalState!;
  return { ...session, goalState: { ...state, status, elapsedMs: goalElapsed(session, now),
    activeSince: status === 'active' ? now : undefined, reason } };
}

// A result belongs to one goal generation. Late completion must not clear a replacement or a paused goal.
export function settleGoal(session: SessionRecord, submitted: SessionRecord, result: AgentResult, now = Date.now()): SessionRecord {
  if (!activeGoal(session) || session.goal !== submitted.goal || session.goalState?.id !== submitted.goalState?.id || !activeGoal(submitted)) return session;
  if (result.status === 'done' && result.goalAchieved) return changeGoalStatus(session, 'complete', undefined, now);
  if (result.status === 'sleeping') return session;
  if (result.status === 'cancelled') return changeGoalStatus(session, 'paused', '已停止当前任务，可以继续目标。', now);
  return changeGoalStatus(session, 'blocked', result.reason || '本轮已结束，目标尚未确认完成。可以继续推进。', now);
}
