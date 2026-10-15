import { Workspace, toolDefinitions, builtinHooks, evaluateHooks, evaluateApproval, isReviewerEligible, isReviewerProtectedPath, reviewApproval, readReviewEntryScripts } from '../../agent.mts';
import { randomUUID } from 'node:crypto';
import { buildReviewContext, readReviewObservation, withReviewApprovals, reviewToolDefinition } from '../../approval-context.mts';

// 由宿主绑定会话、工作目录和权限模式。DSH 策略只能收紧此决定。
export function createDshApproval(options: any) {
  let queue = Promise.resolve();
  let denials = 0;
  const approvals = new Map<string, any[]>();
  return (tool: any) => {
    const operation = queue.then(async () => {
      const { name, args = {}, signal } = tool;
      signal.throwIfAborted();
      const hook = evaluateHooks(builtinHooks, 'before_tool', 'write_file', args)
        || evaluateHooks([...builtinHooks, ...(options.hooks || [])], 'before_tool', name, args)
        || await options.beforeToolExecute?.({ name, args });
      const audit = (decision: string, detail = '') => options.audit?.({ tool: name, summary: `DSH：${name}`, decision, detail });
      if (hook?.action === 'block') { audit('blocked', hook.message); return false; }
      if (['job_list', 'job_output'].includes(name) && hook?.action !== 'require_approval') {
        audit('auto-allowed', '读取当前任务所属的官方后台任务'); return true;
      }
      // 提问入口由运行环境固定，不能被插件的同名工具替换；沿用原有提问权限。
      const extraNames = (options.extraTools || []).map((value: any) => (value.function || value).name);
      const publicName = name === 'ask_user_question' ? 'ask_user' : (options.nativeToolNames?.includes(name) || extraNames.includes(name))
        ? (options.nativeToolAliases?.[name] || name) : `dsh__${name}`;
      const currentMode = () => options.getApprovalMode?.() || options.approvalMode;
      const evaluate = () => evaluateApproval({ name: publicName, args, approvalMode: currentMode(),
        standingRules: options.standingRules || [], hookRequiresApproval: hook?.action === 'require_approval' });
      const decision = evaluate();
      if (decision === 'deny') { audit('denied', '当前任务不允许修改'); return false; }
      if (decision === 'allow') { audit('auto-allowed'); return true; }
      let reason = hook?.message || '';
      if (denials < 3 && !isReviewerProtectedPath(tool.workspacePath || options.workspacePath || '', args.path)
        && isReviewerEligible({ name: publicName, args, approvalMode: currentMode(),
        hookRequiresApproval: hook?.action === 'require_approval' && hook?.reviewable !== true })) {
        const reviewMode = currentMode();
        const sessionKey = tool.sessionId || options.sessionId || '';
        const observation = await readReviewObservation({ name: publicName, args, availableNames: extraNames,
          execute: options.onExtraTool, signal,
          check: (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...(options.hooks || [])], 'before_tool', reader, readArgs)
            || options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const context = withReviewApprovals(await options.getReviewContext?.(tool) || buildReviewContext({ conversation: options.conversation,
          prompt: options.prompt, goal: options.goal, workingContext: options.workingContext }), approvals.get(sessionKey) || []);
        const entryScripts = await readReviewEntryScripts({ workspace: options.workspace || new Workspace(tool.workspacePath || options.workspacePath || ''),
          name: publicName, args, signal,
          preparedFiles: (approvals.get(sessionKey) || []).filter(record => record.tool === 'write_file').map(record => record.args),
          check: (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...(options.hooks || [])], 'before_tool', reader, readArgs)
            || options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const review = await (options.review || reviewApproval)({ settings: options.settings, fetchImpl: options.fetchImpl,
          signal, action: { kind: publicName, title: `DSH：${name}`, details: JSON.stringify(args) + entryScripts, observation,
            toolDefinition: reviewToolDefinition([...(options.extraTools || []), ...toolDefinitions()], name), accessCheck: hook?.message }, context,
          onUsage: options.onUsage });
        signal.throwIfAborted();
        audit(`reviewer-${review.decision === 'ask' ? 'escalated' : review.decision === 'allow' ? 'allowed' : 'denied'}`, review.reason);
        if (currentMode() !== reviewMode) {
          const updated = evaluate();
          if (updated !== 'ask') { audit(updated === 'allow' ? 'auto-allowed' : 'denied', '按更新后的权限重新判断'); return updated === 'allow'; }
        } else if (review.decision === 'allow') { denials = 0; return true; }
        else if (review.decision === 'deny') { denials++; return false; }
        reason = `审核助手无法定夺，转人工确认：${review.reason}`;
      }
      const pending = options.requestApproval?.({ id: tool.callId || randomUUID(), kind: name,
        title: `DSH 插件操作：${name}`, approvalReason: reason, details: [JSON.stringify(args, null, 2), reason].filter(Boolean).join('\n\n') }, evaluate);
      if (!pending) { audit('denied', '没有可用的审批入口'); return false; }
      // 用户关闭会话或停止时不能留下等待中的审批调用。
      let abort: () => void;
      try {
        const allowed = await Promise.race([pending, new Promise((_, reject) => {
          abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        })]);
        signal.throwIfAborted();
        if (allowed === true) { const key = tool.sessionId || options.sessionId || ''; const records = approvals.get(key) || []; records.push({ tool: name, args: structuredClone(args) }); approvals.set(key, records); }
        audit(allowed === null ? 'auto-allowed' : allowed === true ? 'approved' : 'denied'); return allowed === true || allowed === null;
      } finally { signal.removeEventListener('abort', abort); }
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
}
