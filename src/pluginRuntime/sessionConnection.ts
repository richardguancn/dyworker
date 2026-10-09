import { ConnectionController, type ConnectionRecoveryConfig } from './vendor/dsh-connection/index.js';
import { RemoteError, RemoteStreamCarrierError } from './vendor/dsh-session-controller/index.js';

export const HISTORY_CARRIER_LOST='dyworker/history-carrier-lost';
type Operation=(input:{sessionId:string;action:string;payload?:any})=>Promise<any>;
type Generation={id:number;host:{home:string};signal:AbortSignal};
type State='connected'|'disconnected'|'connecting'|undefined;

/** The original supervisor owns retries; the application owns the local, root-bound IPC carrier. */
export function createSessionConnection(rootId:string,operation:Operation,live:()=>boolean,
  connected:()=>void,recovery?:ConnectionRecoveryConfig) {
  let generation:Generation|undefined,published:{id:number;host:{home:string}}|undefined,state:State,serial=0,started=false,closed=false;
  const generations=new Set<()=>void>(),states=new Set<()=>void>();
  const waiting=new Set<{resolve:(generation:Generation)=>void;reject:(error:any)=>void}>();
  const sources=new Set<Promise<void>>();
  const lifetime=new AbortController();
  const errorOf=(error:any)=>new RemoteError(error?.code||'gateway/internal',String(error?.message||error||'连接读取失败'),error?.details||{});
  const emit=(listeners:Set<()=>void>)=>{for(const listener of [...listeners]){try{listener();}catch(error){console.error('连接状态订阅失败',error);}}};
  const withdraw=()=>{if(generation){generation=undefined;published=undefined;emit(generations);}};
  async function source(signal:AbortSignal,ready:(host:{home:string})=>void) {
    let streamId:string|undefined,closing:Promise<any>|undefined;
    const close=()=>{
      if(streamId&&!closing)closing=operation({sessionId:rootId,action:'history-close',payload:{streamId}}).catch(()=>{});
      return closing;
    };
    const abort=()=>{withdraw();void close();};
    signal.addEventListener('abort',abort,{once:true});
    try {
      signal.throwIfAborted();if(!live()||closed)throw new Error('连接所属任务已经关闭');
      const opened=await operation({sessionId:rootId,action:'history-control-open',payload:{address:{kind:'session',sessionId:rootId}}});
      if(!opened?.ok)throw errorOf(opened?.error);
      streamId=opened.value?.streamId;
      signal.throwIfAborted();if(!live()||closed)throw new Error('连接所属任务已经关闭');
      const host=opened.value?.host;
      if(typeof streamId!=='string'||!streamId||opened.value?.frame?.frame?.type!=='baseline'||typeof host?.home!=='string'||!host.home)
        throw errorOf({code:'gateway/bad-request',message:'连接没有返回真实初始记录和主机信息'});
      // Keep the generation signal outside public Host facts; consumers cannot abort it.
      currentSignal=signal;
      ready({home:host.home});
      while(!signal.aborted&&live()&&!closed) {
        const next=await operation({sessionId:rootId,action:'history-next',payload:{streamId}});
        signal.throwIfAborted();
        if(!next?.ok)throw errorOf(next?.error);
        if(next.value?.done)throw new RemoteStreamCarrierError('实际连接订阅已经结束');
      }
    } catch(error) {
      if(!signal.aborted&&!closed){for(const waiter of [...waiting])waiter.reject(error);waiting.clear();}
      throw error;
    } finally {
      withdraw();signal.removeEventListener('abort',abort);await close();
    }
  }
  let currentSignal:AbortSignal|undefined;
  const controller=new ConnectionController((signal,ready)=>{
    const pending=source(signal,ready);sources.add(pending);
    void pending.finally(()=>sources.delete(pending)).catch(()=>{});return pending;
  },{
    onStateChange:next=>{if(next!=='connected')withdraw();state=next;emit(states);},
    onConnected:host=>{
      if(closed||!live()||!currentSignal||currentSignal.aborted)return;
      generation={id:++serial,host,signal:currentSignal};published={id:generation.id,host};emit(generations);
      for(const waiter of [...waiting])waiter.resolve(generation);waiting.clear();
      connected();
    },
  },recovery);
  const connection={
    isLoopback:true,
    generation:{getSnapshot:()=>published,subscribe:(listener:()=>void)=>{generations.add(listener);return()=>{generations.delete(listener);};}},
    state:{getSnapshot:()=>state,subscribe:(listener:()=>void)=>{states.add(listener);return()=>{states.delete(listener);};}},
    reconnect:()=>{if(!closed)controller.reconnect();},
  };
  async function ready(signal:AbortSignal=lifetime.signal):Promise<Generation> {
    signal.throwIfAborted();lifetime.signal.throwIfAborted();if(!live())throw new Error('连接所属任务已经关闭');
    if(generation&&!generation.signal.aborted)return generation;
    const outcome=Promise.withResolvers<Generation>();
    const waiter={resolve:outcome.resolve,reject:outcome.reject};waiting.add(waiter);
    const aborted=()=>waiter.reject(signal.reason||lifetime.signal.reason);
    signal.addEventListener('abort',aborted,{once:true});
    if(!started){started=true;controller.start();}
    try{return await outcome.promise;}finally{waiting.delete(waiter);signal.removeEventListener('abort',aborted);}
  }
  return {connection,ready,
    current:()=>generation,
    lost:()=>{if(!closed&&generation){withdraw();controller.reconnect();}},
    async dispose(){
      if(closed)return;closed=true;lifetime.abort(new Error('连接所属任务已经关闭'));controller.stop();withdraw();
      for(const waiter of [...waiting])waiter.reject(lifetime.signal.reason);waiting.clear();
      await Promise.allSettled([...sources]);state=undefined;emit(states);generations.clear();states.clear();
    },
  };
}
