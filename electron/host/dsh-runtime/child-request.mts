/** 共享的提交形状校验；不把官方 DSH 服务声明引入应用宿主的同名服务。 */
export function isChildPrompt(payload: any): boolean {
  return typeof payload?.childSessionId === 'string' && !!payload.childSessionId
    && typeof payload.parentSessionId === 'string' && !!payload.parentSessionId && payload.mode === 'continuable'
    && typeof payload.requestId === 'string' && !!payload.requestId && payload.requestId.length <= 200
    && ['queue','steer'].includes(payload.delivery) && Array.isArray(payload.content)
    && payload.content.length > 0 && payload.content.length <= 100;
}
