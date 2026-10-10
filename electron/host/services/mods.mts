import {Service} from '@deepseek-ai/cordis';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {readMod,modOptions,MOD_EVENTS} from '../mods/manifest.mts';
import {ModProcess} from '../mods/process.mts';
import {MOD_CATALOG,bundledModsRoot} from '../mods/catalog.mts';

declare module '@deepseek-ai/cordis'{interface Context{mods:ModsService}}
const toolNames:any={run_command:'Bash',read_file:'Read',write_file:'Write',edit_file:'Edit',delete_file:'Delete',append_file:'Append',move_file:'Move',copy_file:'Copy'};
function modTool(name:string,args:any){if(!toolNames[name])return {tool:name,arguments:args};const input={...args};if('path'in input){input.file_path=input.path;delete input.path;}
 if(name==='edit_file'){input.old_string=input.find;input.new_string=input.replace;delete input.find;delete input.replace;}
 return {...input,tool:toolNames[name]||name};}
function nativeTool(name:string,event:any){const {tool,...args}=event;if(tool!==(toolNames[name]||name))throw new Error('模组不能替换工具身份');
 if(!toolNames[name]){if(!args.arguments||typeof args.arguments!=='object'||Array.isArray(args.arguments))throw new Error('模组返回的参数不正确');return args.arguments;}
 if('file_path'in args){args.path=args.file_path;delete args.file_path;}if(name==='edit_file'){args.find=args.old_string;args.replace=args.new_string;delete args.old_string;delete args.new_string;}return args;}
export class ModsService extends Service{
  rows:any[]=[];instances=new Map<string,any>();usage=new Map<string,any>();initial:Promise<void>;private writing=Promise.resolve();closed=false;
  config:any;
  constructor(ctx:any,config:any){super(ctx,'mods');this.config=config;this.initial=this.load();this.initial.catch(()=>{});ctx.effect(()=>()=>this.dispose());}
  private async load(){await fs.mkdir(this.config.dir,{recursive:true});try{const rows=JSON.parse(await fs.readFile(path.join(this.config.dir,'installed.json'),'utf8'));
    if(!Array.isArray(rows)||rows.some(row=>!row||!this.validId(row.id)||typeof row.version!=='string')||new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error('模组清单损坏');this.rows=rows;
  }catch(error:any){if(error.code!=='ENOENT')throw error;}}
  private validId(id:any){return typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(id);}
  private mutations=Promise.resolve();
  private mutate<T>(action:()=>Promise<T>){const result=this.mutations.then(async()=>{await this.initial;if(this.closed)throw new Error('模组服务已关闭');return action();});this.mutations=result.then(()=>{},()=>{});return result;}
  private save(){const snapshot=JSON.stringify(this.rows,null,2);this.writing=this.writing.catch(()=>{}).then(async()=>{const file=path.join(this.config.dir,randomUUID()+'.tmp');await fs.writeFile(file,snapshot);await fs.rename(file,path.join(this.config.dir,'installed.json'));});return this.writing;}
  async list(){await this.initial;return {entries:this.rows.map(row=>({...row,error:row.error||'',active:!row.disabled&&!row.error})),catalog:MOD_CATALOG,scope:'办公活动、操作拦截和简单面板；当前不支持所有 Claude Mods。'};}
  async check(directory:string){const mod=await readMod(directory);return {ok:!mod.errors.length,name:mod.manifest.name,version:mod.manifest.version,events:mod.events,methods:mod.methods,errors:mod.errors};}
  install(input:any){return this.mutate(()=>this.installNow(input));}
  private async installNow(input:any){const catalog=MOD_CATALOG.find(row=>row.id===input?.catalogId);
    const source=catalog?path.join(this.config.builtinDir||bundledModsRoot(),catalog.id):String(input?.directory||'');
    if(!source)throw new Error('请选择模组目录');const mod=await readMod(source);if(mod.errors.length)return {ok:false,error:mod.errors.join('；')};
    if(catalog&&(mod.manifest.name!==catalog.id||mod.manifest.version!==catalog.version))throw new Error('随应用提供的模组版本与已验证清单不一致');
    const options=modOptions(mod,input?.config||{});const target=path.join(this.config.dir,'packages',mod.manifest.name);
    const stage=target+'.'+randomUUID();await fs.mkdir(path.dirname(target),{recursive:true});
    // 只复制解析过的代码及声明，符号链接已解析并验证，不携带用户目录中的其他内容。
    await fs.mkdir(stage,{recursive:true});
    try{for(const file of [ '.claude-plugin/plugin.json',mod.hooksFile,...Object.keys(mod.modules)]){
      const dest=path.join(stage,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(mod.root,file),dest);}
      for(const name of ['LICENSE','NOTICE','PROVENANCE.json']){try{await fs.copyFile(path.join(mod.root,name),path.join(stage,name));}catch(error:any){if(error.code!=='ENOENT')throw error;}}
      const staged=await readMod(stage);let startupError='';const probe=new ModProcess(staged,options,async method=>{
        if(method==='session.id')return 'installation-check';if(method==='session.cwd')return '';
        if(method==='session.usage')return {context:null};if(method==='ui.panes')return [];if(method==='store.keys')return [];return null;},message=>{startupError=message;});
      try{await probe.ready;await probe.dispatch('session.start',{},async()=>({}));if(startupError)throw new Error(startupError);}finally{await probe.stop();}
      await this.stopMod(mod.manifest.name);const backup=target+'.backup-'+randomUUID();let hadPrior=false;
      try{await fs.rename(target,backup);hadPrior=true;}catch(error:any){if(error.code!=='ENOENT')throw error;}
      try{await fs.rename(stage,target);}catch(error){if(hadPrior)await fs.rename(backup,target);throw error;}
      const row={id:mod.manifest.name,name:catalog?.name||mod.manifest.name,version:mod.manifest.version,description:catalog?.summary||String(mod.manifest.description||''),
        disabled:false,config:options,catalogId:catalog?.id||null,source:catalog?.source||source,license:catalog?.license||'未核对',events:mod.events,methods:mod.methods};
      const priorRows=this.rows.map(item=>({...item}));const old=this.rows.findIndex(item=>item.id===row.id);if(old<0)this.rows.push(row);else this.rows[old]=row;
      try{await this.save();}catch(error){this.rows=priorRows;await fs.rm(target,{recursive:true,force:true});if(hadPrior)await fs.rename(backup,target);throw error;}
      if(hadPrior)await fs.rm(backup,{recursive:true,force:true});return {ok:true};
    }finally{await fs.rm(stage,{recursive:true,force:true});}
  }
  async stopMod(id:string){for(const [key,instance]of this.instances){if(instance.row.id!==id)continue;this.instances.delete(key);instance.closed=true;await instance.process?.stop();}}
  enable(id:string,enabled:boolean){return this.mutate(async()=>{const row=this.rows.find(item=>item.id===id);if(!row)throw new Error('模组不存在');await this.stopMod(id);const prior={...row};row.disabled=!enabled;delete row.error;try{await this.save();}catch(error){Object.assign(row,prior);throw error;}return {ok:true};});}
  configure(id:string,config:any){return this.mutate(async()=>{const row=this.rows.find(item=>item.id===id);if(!row)throw new Error('模组不存在');const mod=await readMod(path.join(this.config.dir,'packages',id));const value=modOptions(mod,config);await this.stopMod(id);const prior={...row};row.config=value;delete row.error;try{await this.save();}catch(error){Object.assign(row,prior);throw error;}return {ok:true};});}
  uninstall(id:string){return this.mutate(async()=>{if(!this.rows.some(row=>row.id===id))throw new Error('模组不存在');await this.stopMod(id);const prior=this.rows;this.rows=this.rows.filter(row=>row.id!==id);try{await this.save();}catch(error){this.rows=prior;throw error;}await fs.rm(path.join(this.config.dir,'packages',id),{recursive:true,force:true});return {ok:true};});}
  private async instance(row:any,sessionId:string,signal?:AbortSignal){signal?.throwIfAborted();const key=JSON.stringify([sessionId,row.id]);let existing=this.instances.get(key);if(existing?.process?.closed){this.instances.delete(key);existing=undefined;}if(existing){await existing.ready;return existing;}
    const item:any={row,sessionId,panes:[],status:'',logs:[],closed:false};this.instances.set(key,item);
    const abort=()=>{item.closed=true;void item.process?.stop();};signal?.addEventListener('abort',abort,{once:true});
    item.ready=(async()=>{const mod=await readMod(path.join(this.config.dir,'packages',row.id));if(mod.errors.length)throw new Error(mod.errors.join('；'));
      if(item.closed||this.closed)throw new Error('模组已停用');
      item.process=new ModProcess(mod,row.config,(method,args)=>this.api(item,method,args),message=>{item.error=message;});await item.process.ready;
      if(item.closed||this.closed)throw new Error('模组已停用');
      await item.process.dispatch('session.start',{sessionId},async()=>({}));})();
    try{await item.ready;signal?.throwIfAborted();return item;}catch(error:any){if(this.instances.get(key)===item)this.instances.delete(key);await item.process?.stop();if(!item.closed&&!this.closed){row.error=error.message;await this.save();}if(signal?.aborted)signal.throwIfAborted();throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  private async api(item:any,method:string,args:any[]){if(item.closed)throw new Error('模组已停用');
    const session=this.ctx.sessions.get(item.sessionId);const [value]=args;
    switch(method){
      case 'session.id':return item.sessionId;case 'session.cwd':return session?.workspacePath||'';
      case 'session.version':return 'dyworker-mods/1';case 'session.usage':return {context:this.usage.get(item.sessionId)||null};
      case 'ui.invalidate':return null;case 'ui.panes':return item.panes;
      case 'ui.open':{if(!value||typeof value.id!=='string'||value.id.length>100)throw new Error('面板编号不正确');if(!item.panes.some(row=>row.id===value.id))item.panes.push({id:value.id,title:String(value.title||item.row.name)});return value.id;}
      case 'ui.close':item.panes=item.panes.filter(row=>row.id!==(typeof value==='string'?value:value?.id));return null;
      case 'ui.status':item.status=String(value||'').slice(0,4000);return null;
      case 'ui.log':case 'ui.toast':item.logs.push(String(value||'').slice(0,4000));item.logs=item.logs.slice(-20);return null;
      case 'command.register':{if(!value||!/^[a-z0-9-]+$/.test(value.name))throw new Error('命令名称不正确');item.commands??=[];if(item.commands.some(row=>row.name===value.name))throw new Error('命令重复登记');item.commands.push({...value,description:String(value.description||'')});return null;}
      case 'store.get':case 'store.set':case 'store.delete':case 'store.keys':return this.store(item.row.id,method,args);
      default:throw new Error(`尚未支持 ${method}`);
    }
  }
  private stores=new Map<string,any>();private storeWrites=Promise.resolve();
  private store(id:string,method:string,args:any[]){const result=this.storeWrites.then(()=>this.storeNow(id,method,args));this.storeWrites=result.then(()=>{},()=>{});return result;}
  private async storeNow(id:string,method:string,args:any[]){const file=path.join(this.config.dir,'state',createHash('sha256').update(id).digest('hex')+'.json');
    let values=this.stores.get(id);if(!values){try{values=JSON.parse(await fs.readFile(file,'utf8'));if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('模组数据损坏');}catch(error:any){if(error.code!=='ENOENT')throw error;values={};}this.stores.set(id,values);}
    if(method==='store.keys')return Object.keys(values);const key=args[0];if(typeof key!=='string'||key.length>200||['__proto__','constructor','prototype'].includes(key))throw new Error('数据名称不正确');
    if(method==='store.get')return values[key]??null;const copy={...values};if(method==='store.delete')delete copy[key];else copy[key]=args[1];const text=JSON.stringify(copy);if(text.length>1024*1024)throw new Error('模组保存的数据过大');
    await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID();try{await fs.writeFile(tmp,text);await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}this.stores.set(id,copy);return null;
  }
  recordUsage(sessionId:string,event:any,contextWindow?:number){const prompt=Number(event.prompt);if(!Number.isFinite(prompt)||!Number.isFinite(contextWindow)||contextWindow<=0)return;
    this.usage.set(sessionId,{tokens:prompt,window:contextWindow,percent:prompt/contextWindow*100,estimated:!!event.estimated});}
  async dispatch(sessionId:string,event:string,input:any,next:(value:any)=>Promise<any>,signal?:AbortSignal){await this.initial;if(this.closed)throw new Error('模组服务已关闭');if(!MOD_EVENTS.includes(event))throw new Error('事件不支持');
    const rows=this.rows.filter(row=>!row.disabled&&!row.error);const run=async(index:number,value:any):Promise<any>=>{
      if(index===rows.length)return next(value);const item=await this.instance(rows[index],sessionId,signal);
      if(signal?.aborted){await item.process.stop();signal.throwIfAborted();}
      return item.process.dispatch(event,value,changed=>run(index+1,changed),signal);};return run(0,input);}
  async aroundTool(sessionId:string,name:string,args:any,execute:(args:any)=>Promise<any>,signal?:AbortSignal){let original:any;
    const result=await this.dispatch(sessionId,'tool.call',modTool(name,args),async event=>{original=await execute(nativeTool(name,event));
      return {result:original?.message?.content??String(original??''),isError:original?.isError===true||String(original?.message?.content||'').startsWith('失败')};},signal);
    if(result?.deny){await this.ctx.audit.record({sessionId,tool:name,decision:'blocked',summary:'Claude Mod 阻止操作',detail:String(result.deny)});return {message:{content:`失败\n模组阻止了此操作：${String(result.deny)}`}};}
    if(original)return {...original,message:original.message?{...original.message,content:typeof result?.result==='string'?result.result:original.message.content}:original.message};
    if(result&&Object.hasOwn(result,'result'))return {message:{content:String(result.result??'')}};
    throw new Error('模组返回了无效工具结果');}
  private toolWaits=new Map<string,any>();
  async prepareTool(sessionId:string,name:string,args:any,signal?:AbortSignal){
    const key=randomUUID();let permit:any,complete:any;
    const permitted=new Promise<any>(resolve=>permit=resolve),completion=new Promise<any>(resolve=>complete=resolve);
    let called=false;
    const finished=this.aroundTool(sessionId,name,args,async changed=>{if(called)throw new Error('DSH 会话暂不支持模组重复执行同一操作');called=true;permit({key,args:changed});return completion;},signal);
    this.toolWaits.set(key,{sessionId,complete,finished});finished.then(()=>this.toolWaits.delete(key),()=>this.toolWaits.delete(key));
    return Promise.race([permitted,finished.then(result=>({skip:true,result}))]);
  }
  async finishTool(key:string,result:any){const wait=this.toolWaits.get(key);if(!wait)return result;wait.complete({isError:!!result.isError,message:{content:result.content?.map(item=>item.text||'').join('\n')||''}});
    const value=await wait.finished;const text=value?.message?.content;
    return typeof text==='string'&&text!==result.content?.map(item=>item.text||'').join('\n')?{...result,content:[{type:'text',text}]}:result;}
  cancelTool(key:string){const wait=this.toolWaits.get(key);if(wait){this.toolWaits.delete(key);wait.complete({message:{content:'失败\n所属 DSH 操作已结束'}});}}
  async snapshot(sessionId:string){await this.initial;const output=[];for(const row of this.rows.filter(row=>!row.disabled&&!row.error)){
    try{const item=await this.instance(row,sessionId);const views=[];
      for(const site of [{component:'AbovePrompt'},...item.panes.map(pane=>({component:'Pane',id:pane.id,props:{id:pane.id}}))]){
        const tree=await item.process.dispatch('ui.render',{...site,bodyColumns:80,props:{bodyColumns:80,...site.props},app:'desktop'},async()=>null);
        if(tree)views.push({id:(site as any).id||'band',tree});}
      output.push({id:row.id,name:row.name,status:item.status,logs:item.logs,commands:item.commands||[],views,error:item.error||'',estimated:!!this.usage.get(sessionId)?.estimated});
    }catch(error:any){output.push({id:row.id,name:row.name,error:error.message,views:[],logs:[],commands:[]});}}
    return output;}
  async action(sessionId:string,id:string,input:any){const row=this.rows.find(row=>row.id===id&&!row.disabled&&!row.error);if(!row)throw new Error('模组不存在或已停用');const item=await this.instance(row,sessionId);
    if(input.command){if(!item.commands?.some(row=>row.name===input.command))throw new Error('命令未登记');return item.process.dispatch('command.run',{command:input.command,args:String(input.args||'')},async()=>({}));}
    if(!['ui.press','ui.input','ui.select'].includes(input.event))throw new Error('操作不支持');return item.process.dispatch(input.event,{actionId:String(input.actionId),value:input.value},async()=>({}));}
  async end(sessionId:string){for(const [key,item]of this.instances){if(item.sessionId!==sessionId)continue;this.instances.delete(key);try{await item.process.dispatch('session.end',{reason:'other'},async()=>({}));}finally{item.closed=true;await item.process.stop();}}this.usage.delete(sessionId);}
  async dispose(){this.closed=true;for(const item of this.instances.values()){item.closed=true;await item.process?.stop();}this.instances.clear();await Promise.allSettled([this.writing,this.storeWrites]);}
}
