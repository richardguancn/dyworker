import { normalizeApprovalMode } from '../../settings.mts';

/** 桌面用户显式开始的新执行。占用、审批、停止均沿用桌面任务，接收确认先于执行结束。 */
export function createChildEntry(deps: any) {
  return function start({payload, sender}: any) {
    const sessionId = String(payload?.sessionId || '').trim();
    const runId = String(payload?.runId || '').trim();
    const reject = (message: string) => Promise.resolve({ok:false,error:{message}});
    if (!sessionId || !runId || runId.length > 200) return reject('任务标识无效');
    if (deps.isShuttingDown()) return reject('应用正在退出');
    const session = deps.sessions.get(sessionId);
    if (session?.runtime !== 'dsh' || !session.workspacePath) return reject('所属任务没有可用的 DSH 工作目录');
    if (deps.isSessionBusy(sessionId)) return reject('所属任务正在执行，请使用当前运行中的子任务发送入口');
    const abortController = new AbortController();
    const state = {sessionId,runId,sender,abortController,cancelled:false,pending:new Map()};
    deps.activeAgents.set(sessionId,state);
    let admitted = false;
    let respond: (value: any) => void;
    const acknowledgement = new Promise(resolve => respond = resolve);
    const emit = (event: any) => deps.emit(sender,{sessionId,runId,childRun:true,event});
    const respondError = (error: any) => {
      if (!admitted) respond({ok:false,error:{message:String(error?.message || error),
        ...(error?.code ? {code:error.code,details:error.details} : {})}});
    };
    emit({type:'queue-start',count:deps.queueCount(sessionId)});
    deps.trackStart?.();
    void (async () => {
      try {
        const settings = await deps.readSettings();
        abortController.signal.throwIfAborted();
        const result = await deps.agent.run({runtime:'dsh',sessionId,runId,settings,
          workspacePath:session.workspacePath,approvalMode:normalizeApprovalMode(settings.approvalMode),
          childPrompt:payload.prompt,signal:abortController.signal,isCancelled:()=>state.cancelled,
          routerOptions:{renderer:sender,sessionId,runId,signal:abortController.signal},
          requestApproval:(action: any) => new Promise(resolve => {
            state.pending.set(action.id,resolve); emit({type:'approval-request',action});
          }),
          requestUserInput:(request: any, signal?: AbortSignal) => new Promise(resolve => {
            const key = `q:${request.id}`;
            const abort = () => {state.pending.delete(key);resolve({ok:false,reason:'任务已停止'});};
            signal?.addEventListener('abort',abort,{once:true});
            state.pending.set(key,(answer: any)=>{signal?.removeEventListener('abort',abort);resolve(answer);});
            emit({type:'ask-user',request}); if (signal?.aborted) abort();
          }),
          onChildAdmitted:(receipt: any) => {
            admitted = true; respond({ok:true,value:receipt,runId});
          },
          emit,
        });
        if (!admitted) respondError(new Error('子任务没有确认接收'));
        emit({type:'agent-finished',result});
      } catch (error) {
        respondError(error);
        emit({type:'agent-finished',result:{status:abortController.signal.aborted?'cancelled':'error',finalText:'',reason:String((error as any)?.message || error)}});
      } finally {
        abortController.abort(new Error('子任务本轮已结束'));
        for (const resolve of state.pending.values()) (resolve as any)(false);
        state.pending.clear(); deps.trackEnd?.();
        if (deps.activeAgents.get(sessionId) === state) {
          deps.activeAgents.delete(sessionId); deps.drainSessionQueue(sessionId);
        }
      }
    })();
    return acknowledgement;
  };
}
