import {Context} from '@deepseek-ai/cordis';
import {ClientSessions,RemoteError} from './vendor/dsh-session-controller/index.js';

/** Original global catalog projection; reference/history owners remain per physical root. */
export function createSessionCatalog(parent:Context,options:{operation:(signal:AbortSignal)=>Promise<any>;version:()=>string;live:()=>boolean;published:(value:any,state:any)=>void}){
 const fiber=parent.isolate('sessions').plugin({name:'dyworker-original-global-catalog',apply(){}});
 const lifetime=new AbortController();
 let error:any,received:any,receivedVersion:string|undefined,closed=false,pending:Promise<void>|undefined;
 const errorOf=(value:any)=>new RemoteError(value?.code||'gateway/internal',String(value?.message||value||'任务目录读取失败'),value?.details||{});
 const sessions=new ClientSessions(fiber.ctx,{session:{list:async()=>{
  const version=options.version();
  try{
   if(closed||!options.live())throw new Error('任务目录所属客户端已关闭');
   const reply=await options.operation(lifetime.signal);
   if(closed||!options.live())throw new Error('任务目录所属客户端已关闭');
   if(options.version()!==version)throw new Error('目录读取期间任务列表已变化，请重新读取');
   if(!reply?.ok)throw errorOf(reply?.error);
   received=reply.value;receivedVersion=version;error=undefined;
   return {ok:true,value:{items:received.items}};
  }catch(reason){error=errorOf(reason);received=undefined;return {ok:false,error};}
 }}} as any);
 return {sessions,refresh(){
  if(closed||!options.live())return Promise.reject(new Error('任务目录所属客户端已关闭'));
  if(pending)return pending;
  pending=(async()=>{await sessions.refresh();await Promise.resolve();if(error)throw error;
   if(closed||!options.live())throw new Error('任务目录所属客户端已关闭');
   if(options.version()!==receivedVersion)throw new Error('目录发布前任务列表已变化，请重新读取');
   if(received)options.published(received,sessions.list.getSnapshot());
  })().finally(()=>{pending=undefined;});return pending;
 },remove(ids:string[]){for(const id of ids)sessions.handleSessionRemoved(id);},
 async dispose(){closed=true;lifetime.abort(new Error('任务目录所属客户端已关闭'));await fiber.dispose();await pending?.catch(()=>{});}};
}
