import {Context} from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import {SessionPersistence,SessionPersistenceNotFoundError,SessionReadOnlyError} from '@deepseek-ai/dsh-session-persistence';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import {ApiSessionList,foldSubagentDescriptor,subagentCatalogProjectionDefinition as catalog} from './vendor/session-history.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

export type CorpusRoot={id:string;workspacePath:string;runtime:string;createdAt?:string};
export type CorpusSource={provider:any;rootId:string;header:any;address?:{parentSessionId:string;childSessionId:string;mode:string}};
export type CorpusOptions={dir:string;signal:AbortSignal;roots:()=>Promise<CorpusRoot[]>;active:(id:string)=>any;ready?:(id:string,active:any,signal:AbortSignal)=>Promise<void>};
const signature=(rows:CorpusRoot[])=>JSON.stringify(rows.filter(row=>row.runtime==='dsh').map(row=>[row.id,row.workspacePath,row.createdAt]).sort((a,b)=>a[0].localeCompare(b[0])));

/** One validated, read-only original corpus shared by global catalog and search. */
export async function withDshCorpus<T>(options:CorpusOptions,operation:(corpus:{ctx:any;list:any;records:CorpusRoot[];sources:Map<string,CorpusSource>;draftRootIds:string[]})=>Promise<T>,validate?:(list:any)=>Promise<void>):Promise<T>{
 const {signal}=options;signal.throwIfAborted();
 const ctx=new Context(),readers:Context[]=[],sources=new Map<string,CorpusSource>(),identities=new Map<string,any>();
 try{
  await ctx.plugin(Sessions);await ctx.plugin(Projections);
  class Corpus extends SessionPersistence{
   async create(header:any):Promise<any>{throw new SessionReadOnlyError(header.id,'create');}
   async open(id:any,access:any,opts:any={}):Promise<any>{
    signal.throwIfAborted();opts.signal?.throwIfAborted();
    if(access!=='read')throw new SessionReadOnlyError(id,'open');
    const source=sources.get(id);if(!source)throw new SessionPersistenceNotFoundError(id);
    return source.provider.open(id,'read',opts);
   }
   async flush():Promise<void>{throw new Error('跨任务读取不能写入任务存档');}
   async stat(id:any,opts:any={}):Promise<any>{signal.throwIfAborted();opts.signal?.throwIfAborted();return sources.get(id)?.provider.stat(id,opts);}
   async list(opts:any={}):Promise<any[]>{
    const rows=[];
    for(const [id,source]of sources){signal.throwIfAborted();opts.signal?.throwIfAborted();const row=await source.provider.stat(id,opts);if(!row)throw new SessionPersistenceNotFoundError(id as any);rows.push(row);}
    return rows;
   }
  }
  await ctx.plugin(Corpus);await ctx.plugin(Query,{path:':memory:',openAt:'first-search'});
  const list=new ApiSessionList(ctx,16);await validate?.(list);signal.throwIfAborted();
  const records=(await options.roots()).filter(row=>row.runtime==='dsh'),original=signature(records),draftRootIds:string[]=[];
  for(const root of records){
   signal.throwIfAborted();const active=options.active(root.id);if(active)await options.ready?.(root.id,active,signal);
   signal.throwIfAborted();let provider=active?.persistenceContext?.sessionPersistence;
   identities.set(root.id,provider?.identity);
   if(provider)await provider.flush();
   if(!provider){const reader=new Context();readers.push(reader);await reader.plugin(Persistence,{root:path.join(options.dir,createHash('sha256').update(root.id).digest('hex'),'sessions'),compression:'none'});provider=reader.sessionPersistence;}
   const cwd=await fs.realpath(root.workspacePath),queue:any[]=[{id:root.id}];
   for(let at=0;at<queue.length;at++){
    signal.throwIfAborted();const item=queue[at];if(sources.has(item.id))throw new Error('任务存档存在重复身份或循环归属');
    let handle:any;
    try{handle=await provider.open(item.id,'read',{signal});}
    catch(error){if(!item.parentId&&error instanceof SessionPersistenceNotFoundError){draftRootIds.push(root.id);continue;}throw error;}
    try{
     const {events}=await handle.read(0,undefined,{signal}),header=handle.header;
     if(header.id!==item.id||header.cwd!==cwd)throw new Error('任务存档身份或工作目录不匹配');
     if(!item.parentId&&header.origin==='subagent')throw new Error('子任务不能登记为独立根任务');
     let address:CorpusSource['address'];
     if(item.parentId){
      if(header.origin!=='subagent'||header.parentSession!==item.parentId)throw new Error('子任务存档的父任务不匹配');
      const descriptor=foldSubagentDescriptor(events.slice(handle.inheritedEventCount));
      if(!descriptor||(item.mode!=='unknown'&&descriptor.mode!==item.mode))throw new Error('子任务存档的继续方式不匹配');
      address={parentSessionId:item.parentId,childSessionId:item.id,mode:descriptor.mode};
     }
     let state=catalog.init(header,handle.inheritedEventCount);for(const event of events)state=catalog.apply(state,event);
     sources.set(item.id,{provider,rootId:root.id,header,...(address?{address}:{})});
     for(const child of catalog.wire.view(state)){if(!child.id)throw new Error('子任务目录中的身份无效');queue.push({id:child.id,parentId:item.id,mode:child.mode});}
    }finally{await handle.close();}
   }
  }
  const result=await operation({ctx,list,records,sources,draftRootIds});signal.throwIfAborted();
  const current=await options.roots();signal.throwIfAborted();
  if(signature(current)!==original)throw new Error('读取期间任务列表已变化，请重新读取');
  for(const [id,identity]of identities)if(options.active(id)?.persistenceContext?.sessionPersistence?.identity!==identity)throw new Error('读取期间任务读取来源已变化，请重新读取');
  return result;
 }finally{try{await ctx.fiber.dispose();}finally{await Promise.all(readers.map(reader=>reader.fiber.dispose()));}}
}
