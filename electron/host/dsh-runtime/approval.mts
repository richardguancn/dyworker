import { reviewTaskAction } from '../../approval-policy.mts';
import { Workspace, toolDefinitions, builtinHooks, evaluateHooks, planTaskApproval, reviewApproval, reviewerUnavailableMessage, readReviewEntryScripts } from '../../agent.mts';
import { randomUUID } from 'node:crypto';
import { buildReviewContext, readReviewObservation, withReviewApprovals, reviewToolDefinition, reviewContextFingerprint } from '../../approval-context.mts';

// 由宿主绑定会话、工作目录和权限模式。DSH 策略只能收紧此决定。
export function createDshApproval(options: any) {
  let queue = Promise.resolve();
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
      const evaluate = () => { const updated = planTaskApproval({ name: publicName, args, approvalMode: currentMode(),
        standingRules: options.standingRules || [], hookRequiresApproval: hook?.action === 'require_approval', hook, workspacePath: tool.workspacePath || options.workspacePath || '' });
        return updated === 'execute' ? 'allow' : updated === 'deny' ? 'deny' : 'ask'; };
      const route = planTaskApproval({ name: publicName, args, approvalMode: currentMode(), workspacePath: tool.workspacePath || options.workspacePath || '',
        standingRules: options.standingRules || [], hook, hookRequiresApproval: hook?.action === 'require_approval' });
      const decision = route === 'execute' ? 'allow' : route === 'deny' ? 'deny' : 'ask';
      if (decision === 'deny') { audit('denied', '当前任务不允许修改'); return false; }
      if (decision === 'allow') { audit('auto-allowed'); return true; }
      let reason = hook?.message || '';
      if (route === 'review') {
        const reviewMode = currentMode();
        const sessionKey = tool.sessionId || options.sessionId || '';
        const observation = await readReviewObservation({ name: publicName, args, availableNames: extraNames,
          execute: options.onExtraTool, signal,
          check: (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...(options.hooks || [])], 'before_tool', reader, readArgs)
            || options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const getContext = async () => withReviewApprovals(await options.getReviewContext?.(tool) || buildReviewContext({ conversation: options.conversation,
          prompt: options.prompt, goal: options.goal, workingContext: options.workingContext }), approvals.get(sessionKey) || []);
        const context = await getContext();
        const readEntryScripts = () => readReviewEntryScripts({ workspace: options.workspace || new Workspace(tool.workspacePath || options.workspacePath || ''),
          name: publicName, args, signal,
          preparedFiles: (approvals.get(sessionKey) || []).filter(record => record.tool === 'write_file').map(record => record.args),
          check: (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...(options.hooks || [])], 'before_tool', reader, readArgs)
            || options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const entryScripts = await readEntryScripts();
        const review = await reviewTaskAction({ version: reviewContextFingerprint(reviewMode + context + entryScripts), signal,
          currentVersion: async () => reviewContextFingerprint(currentMode() + await getContext() + await readEntryScripts()),
          review: options.review || reviewApproval, input: { settings: options.settings, fetchImpl: options.fetchImpl,
          signal, action: { kind: publicName, title: `DSH：${name}`, details: JSON.stringify(args) + entryScripts, observation,
            toolDefinition: reviewToolDefinition([...(options.extraTools || []), ...toolDefinitions()], name), accessCheck: hook?.message }, context,
          onUsage: options.onUsage, contextLimit: options.contextLimit } });
        signal.throwIfAborted();
        if (review.unavailable) {
          audit('reviewer-unavailable', review.reason);
          throw new Error(reviewerUnavailableMessage(review.reason));
        }
        audit(`reviewer-${review.decision === 'ask' ? 'escalated' : review.decision === 'allow' ? 'allowed' : 'denied'}`, review.reason);
        if (review.decision === 'allow') { return true; }
        if (review.decision === 'deny') { tool.denialReason = `审核助手拒绝了这次操作：${review.reason}。不要通过改写命令或间接执行绕过拒绝。`; return false; }
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
