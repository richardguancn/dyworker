import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnPluginProcess,terminatePluginProcess} from './process.mts';

export type CatalogPlugin={id:string;entryUrl:string;config:any};

/** 原插件校验临时副本；结束、失败或取消都等待子进程退出后再删除副本。 */
export async function readPluginCatalogCache(input:{profileDir:string;sourceDir:string;workspacePath:string;plugins:CatalogPlugin[];headers:any[];signal:AbortSignal}){
 const signal=AbortSignal.any([input.signal,AbortSignal.timeout(30_000)]);signal.throwIfAborted();
 const dataDir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dyw-catalog-cache-')));
 let child:any;const operations=new Set<Promise<void>>();
 try{
  for(const name of ['storages','profile']){
   signal.throwIfAborted();
   try{await fs.cp(path.join(input.sourceDir,name),path.join(dataDir,name),{recursive:true});}
   catch(error:any){if(error.code!=='ENOENT')throw error;}
  }
  signal.throwIfAborted();
  child=spawnPluginProcess('catalog-cache-worker',{profileDir:input.profileDir,workspacePath:input.workspacePath,dataDir,readOnlyWorkspace:true});
  const result=await new Promise<any>((resolve,reject)=>{
   let response:any,stderr='',received=false;
   const abort=()=>reject(signal.reason);
   const cleanup=()=>signal.removeEventListener('abort',abort);
   child.stderr.on('data',(chunk:any)=>{stderr=(stderr+chunk.toString()).slice(-8192);});
   child.once('error',(error:any)=>{cleanup();reject(error);});
   child.on('message',(value:any)=>{
    if(value?.type!=='file-handle'){response=value;received=true;return;}
    const operation=(async()=>{
     let error:string|undefined;
     try{
      signal.throwIfAborted();
      const root=await fs.realpath(dataDir),file=await fs.realpath(String(value.file)),relative=path.relative(root,file);
      if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('目录读取不能写入临时副本之外的文件');
      const stat=await fs.stat(file);signal.throwIfAborted();
      if(value.operation==='sync'&&(stat.isFile()||stat.isDirectory())){
       const handle=await fs.open(file,stat.isDirectory()?'r':'r+');
       try{await handle.sync();}finally{await handle.close();}
      }else if(value.operation==='chmod'&&stat.isFile()&&Number.isInteger(value.mode)&&value.mode>=0&&value.mode<=0o777)await fs.chmod(file,value.mode);
      else throw new Error('不支持的文件操作');
     }catch(cause:any){error=String(cause?.message||cause);}
     if(child.connected&&!signal.aborted)child.send({type:'file-handle-result',id:value.id,error},()=>{});
    })();
    operations.add(operation);void operation.finally(()=>operations.delete(operation));
   });
   child.once('exit',(code:any)=>{
    cleanup();
    if(response?.error)reject(new Error(response.error));
    else if(code!==0||!received||!Array.isArray(response?.values))reject(new Error(`插件目录读取进程异常退出${stderr?`：${stderr}`:''}`));
    else resolve(response.values);
   });
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();
   else child.send({profileDir:input.profileDir,workspacePath:input.workspacePath,dataDir,plugins:input.plugins,headers:input.headers},(error:any)=>{if(error){cleanup();reject(error);}});
  });
  signal.throwIfAborted();
  const byId=new Map<string,any>(result.map((row:any)=>[row.id,row]));
  return {workerPid:child.pid,cachedSnapshot:(header:any)=>byId.get(header.id)?.snapshot,
   cachedPredecessorTitle:(header:any)=>byId.get(header.id)?.predecessor};
 }finally{
  try{await terminatePluginProcess(child);await Promise.allSettled([...operations]);}finally{await fs.rm(dataDir,{recursive:true,force:true});}
 }
}
