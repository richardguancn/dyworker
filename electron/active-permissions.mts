// 只接受宿主设置服务的变更；任务明确只读时，不允许全局设置扩大权限。
export function activePermissions(initialMode: string, subscribe: any, request: any, signal: AbortSignal) {
  let mode = initialMode;
  const waiting = new Set<() => void>();
  const unsubscribe = subscribe?.((next: string) => {
    if (initialMode === 'deny-changes') return;
    mode = next;
    for (const refresh of waiting) refresh();
  });
  return {
    getMode: () => mode,
    dispose: () => unsubscribe?.(),
    async request(action: any, reevaluate?: () => string) {
      signal.throwIfAborted();
      const decision = reevaluate?.();
      if (decision === 'allow' || decision === 'deny') return decision === 'allow' ? null : false;
      const controller = new AbortController();
      const pendingSignal = AbortSignal.any([signal, controller.signal]);
      let refresh: () => void;
      let abort: () => void;
      const changed = new Promise<boolean | null>((resolve, reject) => {
        refresh = () => {
          const next = reevaluate?.();
          if (next === 'allow' || next === 'deny') resolve(next === 'allow' ? null : false);
        };
        abort = () => reject(signal.reason);
        waiting.add(refresh);
        signal.addEventListener('abort', abort, { once: true });
      });
      let pending: Promise<boolean>;
      let answer: boolean | null;
      try {
        pending = Promise.resolve(request?.(action, pendingSignal)).then(value => value === true);
        answer = await Promise.race([pending, changed]);
      } finally {
        waiting.delete(refresh);
        signal.removeEventListener('abort', abort);
        controller.abort(new Error('权限已更新或审批已结束，此审批已撤回'));
        // 入口须处理撤回信号；等其清除聊天的审批登记，避免旧审批的收尾清掉下一张卡。
        await pending?.catch(() => {});
      }
      // 撤回卡片期间若用户再次收紧权限，不能使用上一次宽松设置的结果。
      return answer === null && reevaluate?.() !== 'allow' ? false : answer;
    },
  };
}

export const workspaceFileGuidance = '新建脚本与交付文件默认保存在当前工作目录，中间文件放 `.dyworker/tmp/` 任务子目录（勿默认建在 `/tmp/`）。直接交工具权限检查，不要先用文字重复索要许可；若被要求审批、拒绝或报错，遵循结果不得绕过。';
