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

export const workspaceFileGuidance = '新建的 Python、JavaScript 等任务脚本和交付文件，默认保存在当前工作目录；中间文件放在当前工作目录的 .dyworker/tmp/ 下，使用任务专属子目录避免覆盖。除非用户明确指定，或工具必须使用系统临时目录，不要默认将任务文件建在 /tmp/。执行脚本时以当前工作目录为工作目录。普通文件创建和脚本执行交给工具权限检查，不要额外用文字或提问工具重复索要许可；若工具要求审批、拒绝或报错，应遵循结果，不得绕过。';
