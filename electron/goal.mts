// Re-read the current goal before queued work starts, including removal and suspension.
export function queuedGoalPayload(payload, session) {
  const goal = typeof session.goal === 'string' && (!session.goalState || session.goalState.status === 'active') ? session.goal : '';
  return { ...payload, goal, goalId: session.goalState?.id,
    ...(session.goal || payload.goal ? { loop: { enabled: Boolean(goal), maximum: goal ? 10 : 1 } } : {}) };
}

export function shouldContinueGoal(result, goal) {
  return goal ? !result.goalAchieved : !result.finish;
}

export function settledStoredGoal(session, payload, result, now = Date.now()) {
  const state = session?.goalState;
  if (!state || state.status !== 'active' || !payload.goal || session.goal !== payload.goal || state.id !== payload.goalId || result.status === 'sleeping') return session;
  const status = result.status === 'done' && result.goalAchieved ? 'complete' : result.status === 'cancelled' ? 'paused' : 'blocked';
  return { ...session, goalState: { ...state, status, activeSince: undefined,
    elapsedMs: Math.max(0, state.elapsedMs || 0) + (state.activeSince === undefined ? 0 : Math.max(0, now - state.activeSince)),
    reason: status === 'complete' ? undefined : result.reason || '本轮已结束，目标尚未确认完成。可以继续推进。' } };
}
