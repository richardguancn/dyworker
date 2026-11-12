// 仅拦截受控网页的按键按下；释放事件仍须送达，避免键盘状态悬挂。
export function browserInputGuard(state, controlledContentsId, contentsId, input) {
  if (!state || controlledContentsId !== contentsId || input?.type !== 'keyDown') return { prevent: false, takeover: false };
  if (state.status === 'running') return { prevent: true, takeover: true };
  if (['human_control', 'paused', 'stopped'].includes(state.status)
    && ['pending', 'failed'].includes(state.inputReleaseState)) return { prevent: true, takeover: false };
  return { prevent: false, takeover: false };
}
