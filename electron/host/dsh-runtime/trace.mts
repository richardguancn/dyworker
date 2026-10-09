/** 从真实请求和官方事件投影现有轨迹格式，不补造首字计时或文件活动。 */
export function createDshTrace(root: string, emit: any) {
  let seq = 0; let turn = 0;
  const owners = new Map<string, any>(); const calls = new Map<string, any>();
  const send = (owner: string, partial: any, timing?: any) => {
    const state = timing || owners.get(owner) || { turn: 0, step: 0 };
    const trace = { seq: ++seq, time: new Date().toISOString(), turn: state.turn, step: state.step,
      depth: owner === root ? 0 : 1, ...partial };
    emit({ type: 'trace', trace }); return trace.seq;
  };
  return {
    request(owner: string, payload: any) {
      const state = { turn: ++turn, step: 0, requestSeq: 0 }; owners.set(owner, state);
      state.requestSeq = send(owner, { kind: 'model-request', direction: 'in', target: 'model',
        title: 'DSH 模型请求', content: JSON.stringify(payload) });
      return { ...state };
    },
    response(owner: string, state: any, message: any) {
      send(owner, { kind: 'model-response', direction: 'out', target: 'model', title: 'DSH 模型回复',
        content: JSON.stringify(message), parentSeq: state.requestSeq }, { ...state, step: 1 });
    },
    usage(owner: string, state: any, usage: any) {
      send(owner, { kind: 'token-usage', direction: 'out', target: 'model', title: 'token 用量', content: '',
        parentSeq: state.requestSeq, usage: { prompt: Number(usage.prompt_tokens) || 0,
          completion: Number(usage.completion_tokens) || 0, estimated: Boolean(usage.estimated) } }, state);
    },
    event(owner: string, event: any) {
      const data = event.data || {};
      if (event.type === 'tool/call') {
        const state = owners.get(owner) || { turn: 0, step: 0 }; state.step++;
        const callSeq = send(owner, { kind: 'tool-call', direction: 'in', target: 'tool', title: `调用工具 ${data.name}`,
          content: typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}) });
        calls.set(`${owner}:${data.callId}`, { ...state, callSeq, name: data.name });
      } else if (event.type === 'tool/result') {
        const key = `${owner}:${data.message?.source?.callId}`; const call = calls.get(key); if (!call) return;
        calls.delete(key);
        send(owner, { kind: 'tool-result', direction: 'out', target: 'tool',
          title: `工具 ${call.name} ${data.message?.isError ? '失败' : '成功'}`, parentSeq: call.callSeq,
          content: (data.message?.content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n') }, { ...call, step: call.step + 1 });
      } else if (['compaction/summary', 'compaction/prune'].includes(event.type)) {
        send(owner, { kind: event.type === 'compaction/summary' ? 'context-compacted' : 'context-pruned',
          direction: 'out', target: 'system', title: 'DSH 上下文整理', content: JSON.stringify(data) });
      }
    },
  };
}
