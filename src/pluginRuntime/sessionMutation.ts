import {Context} from '@deepseek-ai/cordis';
import {ClientSessions,RemoteError} from './vendor/dsh-session-controller/index.js';

/** Original create/fork/title behavior; publication is the real native archive row. */
export function createSessionMutationClient(parent:Context,options:{
  operation:(input:any)=>Promise<any>; published:(record:any)=>void|Promise<void>;
  source:(id:string)=>{rootId:string;address:any}|undefined;
  defaultSession:()=>string; summary:(id:string)=>any;
  renamed:(id:string,title:string)=>void|Promise<void>;
}){
  const fiber=parent.isolate('sessions').plugin({name:'dyworker-session-birth-client',apply(){}});
  let closed=false;
  const errorOf=(error:any)=>new RemoteError(error?.code||'gateway/internal',String(error?.message||error||'任务操作失败'),error?.details||{});
  const call=async(action:string,payload:any)=>{
    if(closed)return {ok:false,error:errorOf({message:'任务创建入口已关闭'})};
    try{
      const reply=await options.operation({sessionId:action==='session-rename'?payload.address.sessionId:'',action,payload});
      if(!reply?.ok)return {ok:false,error:errorOf(reply?.error)};
      // A committed row remains a real task even if this local caller has retired.
      if(reply.value.nativeSession)await options.published(reply.value.nativeSession);
      if(closed)return {ok:false,error:errorOf({message:'任务创建入口已关闭'})};
      return {ok:true,value:reply.value};
    }catch(error){return {ok:false,error:errorOf(error)};}
  };
  const remote={session:{
    create:(request:any)=>call('session-create',{...request,defaultSessionId:options.defaultSession()}),
    fork:async(request:any)=>{
      const target=options.source(request.sessionId);
      return target?call('session-fork',{...request,sourceRootId:target.rootId,address:target.address}):Promise.resolve({ok:false,error:errorOf({code:'session/not-found',message:'原任务不在已知任务中',details:{sessionId:request.sessionId}})});
    },
    rename:async({sessionId,title}:any)=>{
      const reply=await call('session-rename',{address:{kind:'session',sessionId},title});
      if(reply.ok)await options.renamed(sessionId,reply.value.title);return reply;
    },
  }};
  const sessions=new ClientSessions(fiber.ctx,remote);
  return {
    remote: remote.session,
    create:(request:any)=>sessions.create(request),
    fork:async(request:any)=>{
      const summary=options.summary(request.sessionId);
      if(summary)sessions.handleSessionAdded({sessionId:request.sessionId,updatedAt:summary.updatedAt??0,agentAvailable:false,running:summary.running??false,blank:summary.blank??false,
        ...(summary.cwd?{cwd:summary.cwd}:{}),...(summary.parentId?{parentSessionId:summary.parentId}:{}),...(summary.origin?{origin:summary.origin}:{}),
        ...(summary.projectionValues?{projections:{kind:'cached',values:summary.projectionValues}}:{})});
      // Let the original manager publish the received source summary before
      // the original fork method snapshots its durable title.
      await Promise.resolve();
      return sessions.fork(request);
    },
    async dispose(){closed=true;await fiber.dispose();},
  };
}
