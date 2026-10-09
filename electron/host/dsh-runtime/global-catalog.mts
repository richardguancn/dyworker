import {Context} from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import {titleProjectionDefinition} from '@deepseek-ai/dsh-session-title';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import ProjectionCache from '@deepseek-ai/dsh-session-projection-cache';
import {ApiSessionList,subagentCatalogProjectionDefinition,subagentIdentityProjectionDefinition} from './vendor/session-history.mjs';
import {withDshCorpus,type CorpusOptions} from './session-corpus.mts';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readPluginCatalogCache,type CatalogPlugin} from './catalog-cache.mts';

/** Original cold list/cache semantics over the application's authorized root corpus. */
export async function listDshSessions(options:CorpusOptions & {pluginCache?:{profileDir:string;plugins:CatalogPlugin[]}}){
 return withDshCorpus(options,async({ctx,list,records,sources,draftRootIds})=>{
  const caches=new Map<string,any>(),readers:Context[]=[];
  try{
   for(const root of records){
    options.signal.throwIfAborted();
    if(!sources.has(root.id))continue;
    const existing=options.active(root.id)?.persistenceContext?.sessionProjectionCache;
    if(existing){caches.set(root.id,existing);continue;}
    if(options.pluginCache?.plugins.length){
     const headers=[...sources.values()].filter(source=>source.rootId===root.id).map(source=>source.header);
     caches.set(root.id,await readPluginCatalogCache({...options.pluginCache,
      sourceDir:path.join(options.dir,createHash('sha256').update(root.id).digest('hex')),
      workspacePath:sources.get(root.id)!.header.cwd,headers,signal:options.signal}));
     continue;
    }
    const reader=new Context();readers.push(reader);
    await reader.plugin(Sessions);await reader.plugin(Projections);
    reader.sessionProjections.register(titleProjectionDefinition);
    reader.sessionProjections.register(subagentCatalogProjectionDefinition);
    reader.sessionProjections.register(subagentIdentityProjectionDefinition);
    new ApiSessionList(reader,16);
    await reader.plugin(Storage);
    await reader.plugin(JsonStorage,{root:path.join(options.dir,createHash('sha256').update(root.id).digest('hex'),'storages')});
    await reader.plugin(StorageDomain,{backend:'json'});
    await reader.plugin(ProjectionCache,{writeEveryEvents:200,writeIntervalMs:5000});
    await reader.fiber.await();caches.set(root.id,reader.sessionProjectionCache);
   }
   // Delegate cache reads to the original service, which validates lifecycle,
   // schema and unit versions. No parsed checkpoint object impersonates it.
   ctx.provide('sessionProjectionCache',{
    cachedSnapshot:(header:any)=>caches.get(sources.get(header.id)?.rootId)?.cachedSnapshot(header),
    cachedPredecessorTitle:(header:any)=>caches.get(sources.get(header.id)?.rootId)?.cachedPredecessorTitle(header),
   });
   const items:any[]=await list.list(options.signal),byId=new Map(items.map(item=>[item.sessionId,item]));
   for(const root of records){
    options.signal.throwIfAborted();const active=options.active(root.id);
    if(!active?.request)continue;
    await options.ready?.(root.id,active,options.signal);options.signal.throwIfAborted();
    // Only a runtime already owned by the application can report live Agent
    // status. The isolated cold cache reader never creates or resumes an Agent.
    const live=await active.request('history-list',{address:{kind:'session',sessionId:root.id}},{signal:options.signal});
    for(const item of live.items){
     const source=sources.get(item.sessionId);
     if(!source||source.rootId!==root.id||item.cwd!==source.header.cwd
       ||item.parentSessionId!==source.header.parentSession||item.origin!==source.header.origin)
      throw new Error('目录读取期间任务归属已变化，请重新读取');
     byId.set(item.sessionId,item);
    }
   }
   const current=[...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
   return {items:current,rootIdBySession:Object.fromEntries([...sources].map(([id,source])=>[id,source.rootId])),
    addresses:Object.fromEntries([...sources].filter(([,source])=>source.address).map(([id,source])=>[id,source.address])),draftRootIds};
  }finally{await Promise.all(readers.map(reader=>reader.fiber.dispose()));}
 });
}
