import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MOD_EVENTS,MOD_METHODS,MOD_ELEMENTS,modOptions} from './manifest.mts';

export class ModProcess {
  child:any;requests=new Map<string,any>();timers=new Map<string,any>();closed=false;ready:Promise<void>;
  mod:any;options:any;api:any;fault:any;
  constructor(mod:any,options:any,api:(method:string,args:any[])=>Promise<any>,fault:(message:string)=>void){
    this.mod=mod;this.options=options;this.api=api;this.fault=fault;const resolvedOptions=modOptions(mod,options);
    const file=fileURLToPath(new URL(`./worker.${import.meta.url.endsWith('.mts')?'mts':'mjs'}`,import.meta.url)).replace(/app\.asar([/\\])/,'app.asar.unpacked$1');
    this.child=fork(file,[],{execArgv:['--permission',`--allow-fs-read=${path.dirname(file)}`],stdio:['ignore','ignore','pipe','ipc'],env:{ELECTRON_RUN_AS_NODE:'1',NODE_NO_WARNINGS:'1',SystemRoot:process.env.SystemRoot||''}});
    let stderr='';this.child.stderr.on('data',data=>{stderr=(stderr+data).slice(-2000);});
    this.child.on('message',async message=>{
      if(message.type==='rpc'){
        const task=this.requests.get(message.dispatchId);
        const pause=task&&message.method!=='clock.sleep';if(pause)task.pause();
        try{
          if(this.closed)throw new Error('所属模组活动已结束');
          let value;
          if(message.method==='next'){if(!task)throw new Error('缺少所属事件');value=await task.next(message.args[0]);}
          else if(message.method==='fault'){this.fault(`${message.args[0]}：${message.args[1]}`);value=null;}
          else if(message.method==='clock.now')value=Date.now();
          else if(['clock.after','clock.every'].includes(message.method)){
            const [ms,id]=message.args;if(!Number.isFinite(ms)||ms<50||ms>86400000||this.timers.size>=32)throw new Error('计时器间隔或数量不支持');
            const invoke=()=>{if(message.method==='clock.after')this.timers.delete(id);
              void this.dispatch('ui.press',{actionId:id},async()=>({})).catch(error=>this.fault(error.message));};
            this.timers.set(id,message.method==='clock.after'?setTimeout(invoke,ms):setInterval(invoke,ms));value=id;
          }else if(message.method==='clock.cancel'){clearTimeout(this.timers.get(message.args[0]));this.timers.delete(message.args[0]);value=null;}
          else if(message.method==='clock.sleep'){const ms=message.args[0];if(!Number.isFinite(ms)||ms<0||ms>10000)throw new Error('等待时间不支持');value=await new Promise(resolve=>setTimeout(resolve,ms));}
          else value=await this.api(message.method,message.args);
          if(this.child.connected&&!this.closed)this.child.send({type:'reply',id:message.id,value});
        }catch(error:any){if(this.child.connected&&!this.closed)this.child.send({type:'reply',id:message.id,error:error.message});}
        finally{if(pause&&this.requests.has(message.dispatchId))task.resume();}return;
      }
      if(message.type==='result'){const task=this.requests.get(message.id);if(!task)return;
        this.requests.delete(message.id);clearTimeout(task.timer);task.cleanup();message.error?task.reject(new Error(message.error)):task.resolve(message.value);}
    });
    this.ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(new Error('模组启动超时'));void this.stop();},5000);
      const listener=message=>{if(!['ready','error'].includes(message.type))return;clearTimeout(timer);this.child.off('message',listener);
        message.type==='error'?reject(new Error(message.error)):resolve();};this.child.on('message',listener);
      this.child.once('error',error=>{clearTimeout(timer);reject(error);});
      this.child.once('exit',()=>{clearTimeout(timer);reject(new Error(stderr||'模组已退出'));
        if(!this.closed)this.fault(stderr||'模组已退出');this.closed=true;
        for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
        for(const task of this.requests.values()){clearTimeout(task.timer);task.cleanup();task.reject(new Error('模组已退出'));}this.requests.clear();});
      this.child.send({type:'init',input:{...mod,identity:randomUUID(),name:mod.manifest.name,options:resolvedOptions,events:MOD_EVENTS,methods:MOD_METHODS,elements:MOD_ELEMENTS}});
    });
  }
  async dispatch(event:string,input:any,next:(value:any)=>Promise<any>,signal?:AbortSignal){
    await this.ready;signal?.throwIfAborted();if(this.closed)throw new Error('模组已停用');
    return new Promise<any>((resolve,reject)=>{
      const id=randomUUID();const abort=()=>{void this.stop();};signal?.addEventListener('abort',abort,{once:true});
      const task:any={resolve,reject,next,remaining:10000,started:Date.now(),paused:0,cleanup:()=>signal?.removeEventListener('abort',abort)};
      const arm=()=>{task.started=Date.now();task.timer=setTimeout(()=>{this.fault('模组处理超时，已停止');void this.stop();},Math.max(1,task.remaining));};
      task.pause=()=>{if(task.paused++===0){clearTimeout(task.timer);task.remaining-=Math.max(1,Date.now()-task.started);}};
      task.resume=()=>{if(--task.paused===0)arm();};arm();this.requests.set(id,task);
      this.child.send({type:'dispatch',id,event,input});
    });
  }
  async stop(){if(this.closed)return;this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    for(const task of this.requests.values()){clearTimeout(task.timer);task.cleanup();task.reject(new Error('模组已停止'));}this.requests.clear();
    if(this.child.exitCode===null&&this.child.signalCode===null){await new Promise<void>(resolve=>{this.child.once('exit',()=>resolve());this.child.kill('SIGKILL');});}}
}
