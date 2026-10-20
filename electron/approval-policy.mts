// 共享权限路由：风险证据可以交审核，用户明确要求确认的规则不能被模型覆盖。
export type ApprovalRoute = 'execute' | 'review' | 'confirm' | 'deny';
export type ReviewOutcome = { decision: 'allow' | 'deny' | 'ask'; reason: string;
  status?: 'allowed' | 'denied' | 'needs_authorization' | 'needs_evidence' | 'unavailable' | 'cancelled' | 'stale';
  unavailable?: boolean; policyHash?: string; [key: string]: any };

export function approvalRoute({ decision, eligible, hook, protectedTarget = false, reviewRequired = false }: {
  decision: string; eligible: boolean; hook?: any; protectedTarget?: boolean; reviewRequired?: boolean;
}): ApprovalRoute {
  if (hook?.action === 'block' || decision === 'deny') return 'deny';
  if (protectedTarget || (hook?.action === 'require_approval' && hook.reviewable !== true)) return 'confirm';
  if (decision === 'allow' && !hook?.reviewable && !reviewRequired) return 'execute';
  return eligible ? 'review' : 'confirm';
}

export function reviewOutcome(value: any): ReviewOutcome {
  if (value?.needsEvidence) return { ...value, decision: 'ask', status: 'needs_evidence' };
  if (value?.unavailable || ['unavailable', 'stale', 'cancelled'].includes(value?.status)) {
    return { ...value, decision: 'ask', unavailable: true, status: value.status || 'unavailable', reason: String(value.reason || '审核服务未能完成检查') };
  }
  if (!value || !['allow', 'deny', 'ask'].includes(value.decision) || typeof value.reason !== 'string') {
    return { decision: 'ask', status: 'unavailable', unavailable: true, reason: '审核结果无法读取，本次操作未执行' };
  }
  return { ...value, status: value.decision === 'allow' ? 'allowed' : value.decision === 'deny' ? 'denied' : 'needs_authorization' };
}

// 各入口共用服务故障、撤回、迟到结果处理。身份版本同时包含当前授权、事实及模式。
export async function reviewTaskAction({ review, input, currentVersion, version, signal }: {
  review: (input: any) => Promise<any>; input: any; version: string;
  currentVersion: () => string | Promise<string>; signal?: AbortSignal;
}): Promise<ReviewOutcome> {
  signal?.throwIfAborted();
  let result: ReviewOutcome;
  try { result = reviewOutcome(await review(input)); }
  catch (error: any) {
    signal?.throwIfAborted();
    result = reviewOutcome({ unavailable: true, reason: error?.message || String(error) });
  }
  signal?.throwIfAborted();
  if (version !== await currentVersion()) return reviewOutcome({ status: 'stale', unavailable: true,
    reason: '审核期间任务授权或权限设置已改变，旧结论已作废，请按最新任务重新检查' });
  return result;
}
