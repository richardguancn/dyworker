// 审核意见与工具参数同次生成；它不是用户授权，也不替代执行边界。
export const INLINE_APPROVAL_KEY = '__dyworker_approval';

export function inlineApprovalTools(tools: any[]) {
  return tools.map(tool => {
    const fn = tool?.function;
    const schema = fn?.parameters;
    if (!fn || !schema || schema.type !== 'object' || schema.properties?.[INLINE_APPROVAL_KEY]) return tool;
    return { ...tool, function: { ...fn, parameters: { ...schema, properties: { ...schema.properties,
      [INLINE_APPROVAL_KEY]: { type: 'object', description: '对本次操作的审核意见；不影响工具参数',
        properties: { decision: { type: 'string', enum: ['allow', 'deny', 'ask'] }, reason: { type: 'string' } },
        required: ['decision', 'reason'] },
    } } } };
  });
}

export function takeInlineApproval(args: any) {
  const value = args?.[INLINE_APPROVAL_KEY];
  if (args && Object.prototype.hasOwnProperty.call(args, INLINE_APPROVAL_KEY)) delete args[INLINE_APPROVAL_KEY];
  if (!value || !['allow', 'deny', 'ask'].includes(value.decision) || typeof value.reason !== 'string' || !value.reason.trim()) return null;
  return { decision: value.decision, reason: value.reason.trim() };
}
