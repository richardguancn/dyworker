// 共享权限路由：风险证据可以交审核，用户明确要求确认的规则不能被模型覆盖。
export type ApprovalRoute = 'execute' | 'review' | 'confirm' | 'deny';
export class ApprovalNeedsReview extends Error {}

// 已经送审并明确要求人工决定的卡片继续等用户；普通请示可随模式变更改交审核助手。
export function pendingApprovalDecision(current: ApprovalRoute, original: ApprovalRoute) {
  if (current === 'review' && original !== 'review') return 'review';
  return current === 'execute' ? 'allow' : current === 'deny' ? 'deny' : 'ask';
}
export type ReviewOutcome = { decision: 'allow' | 'deny' | 'ask' | 'revise'; reason: string;
  status?: 'allowed' | 'denied' | 'needs_authorization' | 'revision_required' | 'needs_evidence' | 'unavailable' | 'cancelled' | 'stale';
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
  if (value?.unavailable || ['unavailable', 'stale', 'cancelled'].includes(value?.status)) {
    const { needsEvidence, ...failure } = value;
    return { ...failure, decision: 'ask', unavailable: true, status: value.status || 'unavailable', reason: String(value.reason || '审核服务未能完成检查') };
  }
  if (!value || !['allow', 'deny', 'ask', 'revise'].includes(value.decision) || typeof value.reason !== 'string') {
    return { decision: 'ask', status: 'unavailable', unavailable: true, reason: '审核结果无法读取，本次操作未执行' };
  }
  if (value.decision === 'revise') {
    return { decision: 'revise', status: 'revision_required', reason: value.reason, policyHash: value.policyHash };
  }
  if (value.decision === 'ask' && value.needsEvidence === true) return { ...value, status: 'needs_evidence' };
  const { needsEvidence, ...decision } = value;
  return { ...decision, status: value.decision === 'allow' ? 'allowed' : value.decision === 'deny' ? 'denied' : 'needs_authorization' };
}

export function reviewerDenialMessage(reason: string) {
  return `审核助手拒绝了这次操作：${reason}。不要通过改写命令或间接执行绕过拒绝。用户要求停止时立即停止；仍有已授权的独立步骤时可以继续，新操作照常送审。`;
}

export function reviewerRevisionMessage(reason: string) {
  return `本次操作未执行。请调整做法并继续原任务：${reason}。保留原对象和现有数据，按已有授权另选必要步骤；新操作照常送审。不得换工具重复同一越界效果，也不得用替代测试声称已验证原环境。`;
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
    reason: '审核期间任务要求、权限设置或待审操作的依据已变化，旧结论已作废' });
  return result;
}
