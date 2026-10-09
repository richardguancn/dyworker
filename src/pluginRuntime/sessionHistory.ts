import { Context } from '@deepseek-ai/cordis';
import { ClientSessions, createSessionControlStream, RemoteStream, RemoteError, RemoteStreamCarrierError, type Session } from './vendor/dsh-session-controller/index.js';
import {createSessionConnection,HISTORY_CARRIER_LOST} from './sessionConnection.ts';
import type {ConnectionRecoveryConfig} from './vendor/dsh-connection/index.js';

type Operation = (input:{sessionId:string;action:string;payload?:any}) => Promise<any>;
/** IPC is only the carrier; all window, paging and Assistant reconciliation belongs to the original Session. */
export function createSessionHistoryClient(rootId:string, operation:Operation, live:()=>boolean=()=>true, parent?:Context, mutations?:()=>any,
  controlEvent?:(name:string,args:any[])=>void,recovery?:ConnectionRecoveryConfig) {
  const lifetime = new AbortController();
  const wireAddress = {kind:'session',sessionId:rootId};
  const fiber=(parent ?? new Context()).isolate('sessions').isolate('connection').plugin({name:'dyworker-original-session-client',apply(){}});
  let sessions:ClientSessions;
  let listError:RemoteError|null=null;
  const errorOf = (error:any) => new RemoteError(error?.code || 'gateway/internal',String(error?.message || error || '历史读取失败'),error?.details || {});
  const streams=new Set<RemoteStream>();
  let established=false;
  const carrier=createSessionConnection(rootId,operation,()=>live()&&!lifetime.signal.aborted,()=>{
    if(established){for(const stream of streams)stream.restart();}
    established=true;sessions.handleConnected();
  },recovery);
  fiber.ctx.provide('connection',carrier.connection);
  const reading=new Set(['history-page','history-list','history-state','history-search','session-image']);
  function addressFor(id:string) {
    if(id===rootId)return wireAddress;
    const child=sessions.subagentAddress(id);
    if(!child)throw errorOf({code:'session/not-found',message:'操作不属于此根任务的已知子任务'});
    return {kind:'subagent',...child};
  }
  async function call(action:string,payload:any,signal?:AbortSignal) {
    if (!live() || lifetime.signal.aborted) throw errorOf({message:'历史读取所属任务已经关闭'});
    const generation=reading.has(action)?await carrier.ready(AbortSignal.any([lifetime.signal,...(signal?[signal]:[])])):undefined;
    const result = await operation({sessionId:rootId,action,payload});
    if (!live() || lifetime.signal.aborted) throw errorOf({message:'历史读取所属任务已经关闭'});
    signal?.throwIfAborted();
    if(generation&&(generation.signal.aborted||carrier.current()!==generation))throw errorOf({code:HISTORY_CARRIER_LOST,message:'旧连接的读取结果已经失效'});
    if (!result?.ok) throw errorOf(result?.error);
    return result.value;
  }
  async function result(action:string,payload:any,signal?:AbortSignal) {
    try { signal?.throwIfAborted(); const value=await call(action,payload,signal);signal?.throwIfAborted();return {ok:true,value}; }
    catch(error:any) {return {ok:false,error:errorOf(error)};}
  }
  async function birth(action:'create'|'fork',request:any){
    try{
      if(!live()||lifetime.signal.aborted)throw new Error('任务创建所属页面已经关闭');
      if(!mutations)throw new Error('当前应用尚未开放此任务创建入口');
      return await mutations()[action](request);
    }catch(error){return {ok:false,error:errorOf(error)};}
  }
  async function* carry(action:string,request:any,signal:AbortSignal) {
        const openingSignal=AbortSignal.any([signal,lifetime.signal]);openingSignal.throwIfAborted();
        let generation:Awaited<ReturnType<typeof carrier.ready>>|undefined;
        try{generation=await carrier.ready(openingSignal);}catch(error:any){
          if(error?.code===HISTORY_CARRIER_LOST)throw new RemoteStreamCarrierError(error.message);
          throw error;
        }
        const combined=AbortSignal.any([openingSignal,generation.signal]);combined.throwIfAborted();
        let streamId:string|undefined, closing:Promise<any>|undefined;
        const close=()=> {
          if (streamId && !closing) closing=operation({sessionId:rootId,action:'history-close',payload:{streamId}}).catch(()=>{});
          return closing;
        };
        combined.addEventListener('abort',close,{once:true});
        try {
          // A late opening result still owns a handle and must be closed, even if the binding has retired.
          const opened=await operation({sessionId:rootId,action,payload:request});
          if (!opened?.ok) throw errorOf(opened?.error);
          streamId=opened.value.streamId;
          if (combined.aborted || !live()) {await close();combined.throwIfAborted();throw errorOf({message:'历史读取所属任务已经关闭'});}
          yield opened.value.frame;
          while (!combined.aborted && live()) {
            const reply=await operation({sessionId:rootId,action:'history-next',payload:{streamId}});
            combined.throwIfAborted();
            if(!reply?.ok)throw errorOf(reply?.error);
            const next=reply.value;
            if (next.done) return;
            yield next.value;
          }
        } catch(error:any) {
          if(!openingSignal.aborted&&live()&&(generation.signal.aborted||error?.code===HISTORY_CARRIER_LOST))
            throw new RemoteStreamCarrierError(String(error?.message||'连接读取已中断'));
          throw error;
        } finally {combined.removeEventListener('abort',close);await close();}
  }
  const remote = {
    $stream:(options:any)=>{
      const stream=new RemoteStream(carrier.connection,{...options,carrierFailed:(error:any)=>{carrier.lost();options.carrierFailed?.(error);}});
      streams.add(stream);const dispose=stream.dispose.bind(stream);
      stream.dispose=()=>{streams.delete(stream);return dispose();};return stream;
    },
    session: {
      page:(request:any,signal:AbortSignal)=>result('history-page',request,signal),
      follow:(request:any,signal:AbortSignal)=>carry('history-open',request,signal),
      list:async()=>{
        const generation=carrier.current();
        const reply=await result('history-list',{address:wireAddress});
        if(generation===carrier.current())listError=reply.ok?null:errorOf(reply.error);
        return reply;
      },
      projections:async({sessionId}:any,signal:AbortSignal)=>{
        const child=sessionId===rootId?undefined:sessions.subagentAddress(sessionId);
        if(sessionId!==rootId&&!child)return {ok:false,error:errorOf({code:'session/not-found',message:'投影不属于此根任务的已知子任务'})};
        const reply=await result('history-state',{address:child?{kind:'subagent',...child}:wireAddress},signal);
        return reply.ok?{ok:true,value:reply.value.projections}:reply;
      },
      create:(request:any)=>birth('create',request),
      fork:(request:any)=>birth('fork',request),
      search:({query}:any,signal:AbortSignal)=>result('history-search',{address:wireAddress,query},signal),
      async *control(signal:AbortSignal) {
        for await (const envelope of carry('history-control-open',{address:wireAddress},signal)) {
          for(const event of envelope.events || []) {
            const args=event.args;
            switch(event.name) {
              case 'api-session/added':sessions.handleSessionAdded(args[0]);break;
              case 'api-session/removed':sessions.handleSessionRemoved(args[0]);break;
              case 'api-session/status':sessions.handleSessionStatus(args[0],args[1]);break;
              case 'api-session/activity':sessions.handleSessionActivity(args[0],args[1]);break;
              case 'api-session/error':sessions.handleSessionError(args[0],args[1]);break;
              default:throw errorOf({message:'会话状态收到未知事件'});
            }
            if(live()&&!lifetime.signal.aborted)controlEvent?.(event.name,args);
          }
          if(envelope.frame)yield envelope.frame;
        }
      },
      attachment:(request:any,signal?:AbortSignal)=>result('session-image',{targetSessionId:request.sessionId,attachmentId:request.attachmentId},signal),
      prompt:(request:any,signal?:AbortSignal)=>result('input-admit',request,signal),
      updateQueue:(request:any)=>result('input-update-queue',request),
      cancel:()=>result('input-cancel',{}),
      rename:async({sessionId,title}:any)=>{
        try{return await result('session-rename',{address:addressFor(sessionId),title});}
        catch(error){return {ok:false,error:errorOf(error)};}
      },
    },
    subagents:{prompt:(request:any,signal?:AbortSignal)=>result('child-prompt',request,signal),
      interruptByParent:(childSessionId:string,parentSessionId:string)=>result('child-interrupt',{childSessionId,parentSessionId,mode:'continuable'})},
    commands:{execute:async(sessionId:string,line:string,attachments:any[],signal?:AbortSignal)=>{
      try{return await result('session-command',{address:addressFor(sessionId),line,attachments},signal);}
      catch(error){return {ok:false,error:errorOf(error)};}
    }},
  };
  sessions=new ClientSessions(fiber.ctx,remote);
  const refresh=sessions.refresh.bind(sessions);
  sessions.refresh=async()=>{
    // Establish the connection before the original manager starts its list pull.
    // A reconnect discards that manager request; callers must await its replacement.
    while(true){
      const generation=await carrier.ready(lifetime.signal);await refresh();
      if(generation===carrier.current()&&!generation.signal.aborted)return;
      lifetime.signal.throwIfAborted();
    }
  };
  const guarded=new WeakSet<Session>();
  const protect=(reference:any)=>{
    const binding=reference.binding,session:Session=binding.session;
    if(!guarded.has(session)){
      guarded.add(session);
      for(const method of ['prompt','updateQueue','cancel','command','rename','readAttachment'] as const){
        const original=session[method].bind(session) as (...args:any[])=>Promise<any>;
        Object.defineProperty(session,method,{value:(...args:any[])=>{
          if(lifetime.signal.aborted||!live()||sessions.sessionOf(binding.ctx)!==session)
            return Promise.resolve({ok:false,error:errorOf({code:'gateway/bad-request',message:'会话读取范围已经释放'})});
          return original(...args);
        }});
      }
    }
    return reference;
  };
  const retain=sessions.retain.bind(sessions),retainAgent=sessions.retainAgentScope.bind(sessions);
  sessions.retain=(target,options)=>protect(retain(target,options));
  sessions.retainAgentScope=id=>protect(retainAgent(id));
  let control:ReturnType<typeof createSessionControlStream>|undefined,opening:Promise<void>|undefined,controlError:RemoteError|null=null;
  const listeners=new Set<()=>void>();
  const errors={getSnapshot:()=>controlError,subscribe:(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};}};
  let rejectOpening:((error:any)=>void)|undefined;
  async function startControl() {
    if(opening)return opening;
    opening=(async()=>{
      if(controlError){await control?.dispose();control=undefined;controlError=null;for(const listener of listeners)listener();}
      let baseline:Promise<void>=Promise.resolve();
      if(!control) {
        const ready=Promise.withResolvers<void>();baseline=ready.promise;rejectOpening=ready.reject;
        control=createSessionControlStream(remote,{
          accept:(frame:any)=>{sessions.handleControlFrame(frame);if(frame.type==='baseline'){rejectOpening=undefined;ready.resolve();}},
          failed:(error:any)=>{controlError=errorOf(error);rejectOpening=undefined;ready.reject(controlError);for(const listener of listeners)listener();},
        });
        control.start();
      }
      await baseline;
    })().finally(()=>{opening=undefined;});
    return opening;
  }
  async function open(session:Session) {
    await Promise.all([startControl(),sessions.refresh(),session.open()]);
    if(listError)throw listError;
  }
  return {sessions,open,errors,connection:carrier.connection,subscribe(listener:()=>void){
    const stop=sessions.list.subscribe(listener);fiber.ctx.effect(()=>stop);return stop;
  },async dispose() {
    lifetime.abort(new Error('历史读取已关闭'));rejectOpening?.(lifetime.signal.reason);rejectOpening=undefined;
    const disposal=fiber.dispose();
    await Promise.all([control?.dispose(),disposal,carrier.dispose()]);listeners.clear();
  }};
}

/** A validated application route owns one Gateway reference; other consumers acquire independent original references. */
export function createSessionHistoryFace(rootId:string, sessionId:string, address:any, operation:Operation, live:()=>boolean=()=>true,
  shared?:ReturnType<typeof createSessionHistoryClient>) {
  const client=shared ?? createSessionHistoryClient(rootId,operation,live);
  const reference=client.sessions.retainAgentScope(sessionId);
  const session=reference.binding.session;
  if(address)session.configureSubagent(address);
  let closed=false;
  return {session,ctx:reference.binding.ctx,open:()=>{
    if(closed)return Promise.reject(new Error('历史读取所属任务已经关闭'));
    return client.open(session);
  },errors:client.errors,sessions:client.sessions,async dispose() {
    if(closed)return;closed=true;reference.release();
    if(!shared)await client.dispose();
  }};
}
