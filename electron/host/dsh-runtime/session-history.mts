import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { SessionTitleInvalidError, normalizeSessionTitle } from '@deepseek-ai/dsh-session-title';
import { SessionHistoryController, SessionControlController, ApiSessionList, latestCompletedPrefixBoundary } from './vendor/session-history.mjs';
import { SessionSeq } from '@deepseek-ai/dsh-session';
import { buildForkSeed } from '@deepseek-ai/dsh-session/fork';
import { readSessionFamily } from './session-family.mts';
import { followSessionControl } from './session-control.mts';

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'session/title-invalid': {sessionId:string}; }
}

/** Carries original DSH frames; reading a prepared history never grants model execution. */
export function createSessionHistory(ctx: any, rootId: string, workspacePath: string) {
  const history = new SessionHistoryController(ctx, observation => observation[Symbol.dispose]());
  const control = new SessionControlController(ctx);
  const query = {
    listSessions:async(signal:AbortSignal)=>{
      const ids = await scopeIds({kind:'session',sessionId:rootId},signal);
      return (await ctx.sessionQuery.listSessions(signal)).filter((row:any)=>ids.has(row.header.id));
    },
    searchSessions:async(request:any,exec:any)=>{
      const ids = await scopeIds({kind:'session',sessionId:rootId},exec.signal);
      return ctx.sessionQuery.searchSessions({...request,
        sessionFilters:[...(request.sessionFilters || []),{kind:'id',values:[...ids]}]},exec);
    },
  };
  // The original list still registers its real projections once. Only search's
  // provider lookup is scoped; paging is filtered before ranking, never afterwards.
  const list = new ApiSessionList(new Proxy(ctx,{get(target,key){
    return key === 'get' ? (name:string)=>name === 'sessionQuery' ? query : ctx.get(name) : Reflect.get(target,key,target);
  }}),16);
  const followers = new Map<string, { iterator: AsyncIterator<any>; lifetime: AbortController; pending?: Promise<any> }>();
  let closed = false;
  let titleWrites = Promise.resolve();

  async function rename(address: any, title: unknown, signal: AbortSignal) {
    if (typeof title !== 'string') throw new RemoteError('gateway/bad-request', '标题必须是文字', {});
    const id = address.kind === 'session' ? rootId : address.childSessionId;
    const titles = ctx.get('sessionTitle');
    if (!titles) throw new RemoteError('gateway/internal', '此运行环境没有标题服务', {});
    const normalized = normalizeSessionTitle(title,titles.config.maxTitleBytes);
    if(!normalized) throw new RemoteError('session/title-invalid','session title must contain visible characters',{sessionId:id});
    let session = ctx.sessions.get(id), handle: any, detach: (()=>void)|undefined;
    try {
      if (!session) {
        // Take only log ownership: restoring an Agent would also resume pending model work.
        handle = await ctx.sessionPersistence.open(id, 'write', {signal});
        const stored = await handle.read(0, undefined, {signal});
        signal.throwIfAborted();
        if (ctx.sessions.get(id)) throw new Error('标题所属任务已被其他操作打开，请重试');
        session = ctx.sessions.prepare(id, {seed:stored.events,meta:structuredClone(handle.header),
          inheritedEventCount:handle.inheritedEventCount,eventState:stored.eventState});
        const suffix = session.snapshotEvents(stored.events.length);
        if (suffix.length) await handle.append(suffix);
        // A temporary log writer is not a newly created Agent/catalog row.
        detach = ctx.sessions.enter(session);
      }
      signal.throwIfAborted();
      let accepted:any;
      if(handle) {
        // No resident title-generation lifetime exists for a cold metadata writer.
        // Use the original normalizer and durable title vocabulary without retaining
        // a temporary Session in the live title service's work map.
        const event = session.append('session/title',{title:normalized,messageSeqs:[],source:{kind:'user'}});
        accepted = {title:normalized,eventSeq:event.seq};
      }else accepted = titles.rename(session, title);
      // The original backend routes live events to its existing write handle.
      // Forwarded worker events follow the same rule; appending again would duplicate seqs.
      if (handle) await handle.flush();
      else await ctx.sessionPersistence.flush();
      return {title:accepted.title,seq:accepted.eventSeq};
    } catch(error) {
      if(error instanceof SessionTitleInvalidError)
        throw new RemoteError('session/title-invalid', error.message, {sessionId:id});
      throw error;
    } finally {detach?.();await handle?.close();}
  }

  async function authorize(address: any, signal: AbortSignal) {
    signal.throwIfAborted();
    if (closed) throw new Error('历史读取已关闭');
    if (!address || (address.kind !== 'session' && address.kind !== 'subagent'))
      throw new RemoteError('gateway/bad-request', '缺少有效的会话地址', {});
    if (address.kind === 'session') {
      if (address.sessionId !== rootId) throw new RemoteError('session/not-found', '历史不属于当前根任务', {sessionId:address.sessionId});
      return;
    }
    if (typeof address.childSessionId !== 'string' || typeof address.parentSessionId !== 'string'
      || !['unknown', 'continuable', 'one-shot'].includes(address.mode))
      throw new RemoteError('gateway/bad-request', '子任务地址不完整', {});
    const family = await readSessionFamily(ctx, rootId, signal);
    const child = family.byId[address.childSessionId];
    if (!child || child.id === rootId || child.parentId !== address.parentSessionId || child.cwd !== workspacePath)
      throw new RemoteError('subagent/unauthorized', '历史不属于当前根任务的指定子任务', {childSessionId:address.childSessionId});
  }

  async function scopeIds(address:any,signal:AbortSignal) {
    if(address.kind==='subagent')return new Set<string>([address.childSessionId,address.parentSessionId]);
    const family=await readSessionFamily(ctx,rootId,signal);
    const ids=new Set<string>([rootId]);
    for(const child of Object.values(family.byId) as any[]) {
      if(child.id===rootId||child.cwd!==workspacePath)continue;
      await history.page({address:{kind:'subagent',childSessionId:child.id,parentSessionId:child.parentId,mode:'unknown'},throughSeq:-1},signal);
      ids.add(child.id);
    }
    return ids;
  }

  async function close(streamId: string) {
    const follower = followers.get(streamId);
    if (!follower) return false;
    followers.delete(streamId);
    follower.lifetime.abort(new Error('历史订阅已关闭'));
    // Abort wakes the original iterator before return; return alone cannot interrupt a waiting next.
    await follower.pending?.catch(() => {});
    await follower.iterator.return?.();
    return true;
  }

  async function next(streamId: string, signal: AbortSignal) {
    const follower = followers.get(streamId);
    if (!follower) throw new RemoteError('gateway/bad-request', '历史订阅不存在或已经关闭', {});
    if (follower.pending) throw new RemoteError('gateway/bad-request', '同一历史订阅不能同时读取两次', {});
    const abort = () => follower.lifetime.abort(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener('abort', abort, {once:true});
    try {
      follower.pending = follower.iterator.next();
      const result = await follower.pending;
      signal.throwIfAborted();
      if (result.done) { followers.delete(streamId); follower.lifetime.abort(); }
      return result;
    } catch (error) {
      followers.delete(streamId); follower.lifetime.abort(error);
      await follower.iterator.return?.().catch(() => {});
      throw error;
    } finally { follower.pending = undefined; signal.removeEventListener('abort', abort); }
  }

  async function dispose() {
    closed = true;
    await Promise.all([titleWrites,...[...followers.keys()].map(close)]);
  }
  ctx.effect(() => dispose, 'dyworker.session-history');
  return {
    async request(action: string, payload: any, signal: AbortSignal) {
      if (action === 'history-close') return close(String(payload.streamId || ''));
      if (action === 'history-next') return next(String(payload.streamId || ''), signal);
      await authorize(payload.address, signal);
      if (['history-list','history-control-open','history-search','history-fork-seed','session-rename'].includes(action)) {
        // The original history address validation also verifies a cold child's descriptor and mode.
        await history.page({address:payload.address,throughSeq:-1},signal);
      }
      if(action==='history-fork-seed'){
        let atSeq:any;
        if(payload.atSeq!==undefined){
          try{atSeq=SessionSeq(payload.atSeq);}catch{throw new RemoteError('gateway/bad-request','atSeq must be a non-negative safe integer',{});}
        }
        const id=payload.address.kind==='session'?rootId:payload.address.childSessionId;
        const observed=await ctx.sessionQuery.observeSession(id,{signal});
        try{
          const events=observed.events;
          if(payload.messageId!==undefined){
            if(atSeq!==undefined||typeof payload.messageId!=='string')throw new RemoteError('gateway/bad-request','消息位置无效',{});
            const index=events.findIndex((event:any)=>event.type==='user/message'?event.data.id===payload.messageId:event.type==='assistant/message'&&event.data.message.id===payload.messageId);
            if(index<0)throw new RemoteError('gateway/bad-request','这条消息没有对应的 DSH 历史记录',{});
            atSeq=events[index].seq;
            if(payload.turnId!==undefined){
              const start=events.findIndex((event:any)=>event.type==='user/message'&&event.data.source.kind==='user'&&event.data.id===payload.turnId);
              if(start<0||start>index)throw new RemoteError('gateway/bad-request','消息不属于指定对话',{});
              let end=events.findIndex((event:any,at:number)=>at>start&&event.type==='user/message'&&event.data.source.kind==='user');
              if(end<0)end=events.length;
              if(index>=end)throw new RemoteError('gateway/bad-request','消息不属于指定对话',{});
              // A future prompt is queued before its visible user/message.
              // Never copy that admission or the next turn's opening into the
              // assistant bubble's inclusive cut.
              const nextInput=events.findIndex((event:any,at:number)=>at>index&&at<end&&
                (event.type==='turn/start'||(event.type==='agent/inbox/spliced'&&
                  event.data.inserted?.some((message:any)=>message.source?.kind==='user'))));
              if(nextInput>=0)end=nextInput;
              atSeq=events[end-1].seq;
            }
          }else if(payload.turnId!==undefined)throw new RemoteError('gateway/bad-request','缺少对应的消息位置',{});
          const boundary=atSeq??latestCompletedPrefixBoundary(events);
          if(boundary===undefined||events[boundary]?.seq!==boundary)throw new RemoteError('session/fork-unavailable' as any,'此历史位置还不能复制',{sessionId:id} as any);
          return {header:observed.header,seed:buildForkSeed(events,boundary),inheritedEventCount:boundary+1,atSeq:boundary};
        }finally{observed[Symbol.dispose]();}
      }
      if (action === 'history-search') {
        if(typeof payload.query !== 'string') throw new RemoteError('gateway/bad-request','搜索内容必须是文字',{});
        if(payload.address.kind !== 'session') throw new RemoteError('gateway/bad-request','搜索需要根任务地址',{});
        return list.search(payload.query,signal);
      }
      if (action === 'session-rename') {
        const pending = titleWrites.then(async()=>{
          await authorize(payload.address,signal);
          return rename(payload.address,payload.title,signal);
        });
        titleWrites = pending.then(()=>{},()=>{});
        return pending;
      }
      if (action === 'history-list') {
        const ids = await scopeIds(payload.address,signal);
        return {items:(await list.list(signal)).filter((item:any)=>ids.has(item.sessionId))};
      }
      if (action === 'history-state') {
        const target = payload.address.kind === 'session' ? rootId : payload.address.childSessionId;
        const observed = await ctx.sessionQuery.observeSession(target,{signal,projectionMode:'all'});
        try { return {running:ctx.agents.get(target)?.status === 'running',projections:observed.projections}; }
        finally {observed[Symbol.dispose]();}
      }
      if (action === 'history-page') return history.page(payload, signal);
      if (action !== 'history-open' && action !== 'history-control-open') throw new Error('未知的历史读取操作');
      const streamId = randomUUID();
      const lifetime = new AbortController();
      const iterator = (action === 'history-control-open' ? followSessionControl(ctx,control,list,payload.address,lifetime.signal,
        ()=>scopeIds(payload.address,lifetime.signal))
        : history.follow(payload, lifetime.signal))[Symbol.asyncIterator]();
      followers.set(streamId, {iterator, lifetime});
      try {
        const first = await next(streamId, signal);
        if (first.done || (action === 'history-control-open' ? first.value?.frame?.type !== 'baseline' : first.value?.type !== 'snapshot'))
          throw new Error('历史订阅没有返回初始记录');
        return {streamId, frame:first.value,
          ...(action==='history-control-open'?{host:{home:homedir()}}:{})};
      } catch (error) { await close(streamId); throw error; }
    },
    dispose,
  };
}
