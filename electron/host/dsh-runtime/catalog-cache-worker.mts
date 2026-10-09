// 装载真实插件的统计定义，仅在临时副本中读取原始缓存，不创建或恢复 Agent。
import {createOfficialDshContext} from './official-context.mts';
import {installFileHandleBridge} from './file-handles.mts';
import {registerPluginModules} from '../plugin-module-cache.mts';
import {mountDshProfile} from './profile.mts';
import {createPtcProxy} from './ptc-proxy.mts';
import {ApiSessionList,subagentCatalogProjectionDefinition,subagentIdentityProjectionDefinition} from './vendor/session-history.mjs';

installFileHandleBridge();
process.once('message',async(input:any)=>{
 let ctx:any,release:(()=>void)|undefined,result:any;
 try{
  release=registerPluginModules(input.profileDir);
  const deny=()=>{throw new Error('目录读取不能执行任务');};
  ctx=await createOfficialDshContext({...input,ptc:createPtcProxy(deny)});
  // 禁止插件在初始化期间自动创建或恢复任务；不安装应用模型适配器。
  for(const method of ['create','resume'])Object.defineProperty(ctx.agents,method,{value:deny,writable:false,configurable:false});
  Object.defineProperty(ctx.llm,'stream',{value:deny,writable:false,configurable:false});
  ctx.tools.guard(()=> '目录读取不能执行工具');
  ctx.sessionProjections.register(subagentCatalogProjectionDefinition);
  ctx.sessionProjections.register(subagentIdentityProjectionDefinition);
  new ApiSessionList(ctx,16);
  await mountDshProfile(ctx,input);
  if(ctx.agents.list().length)throw new Error('目录读取期间出现了任务实例');
  result={values:input.headers.map((header:any)=>({id:header.id,
   snapshot:ctx.sessionProjectionCache.cachedSnapshot(header),
   predecessor:ctx.sessionProjectionCache.cachedPredecessorTitle(header)}))};
 }catch(error:any){result={error:String(error?.message||error)+(error?.resource?`（${error.resource}）`:'')};}
 finally{
  try{await ctx?.fiber.dispose();}catch(error:any){result={error:String(error?.message||error)};}
  release?.();
 }
 process.send?.(result,()=>process.exit(result.error?1:0));
});
