import {Context} from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Attachments from '@deepseek-ai/dsh-attachment-local';
import {SessionPersistence,SessionReadOnlyError} from '@deepseek-ai/dsh-session-persistence';
import {subagentCatalogProjectionDefinition,subagentIdentityProjectionDefinition} from './vendor/session-history.mjs';
import {createSessionHistory} from './session-history.mts';
import path from 'node:path';

/** A cold fork reads the original log without preparing/resuming its Agent. */
export async function readDshForkSource(options:{dataDir:string;rootId:string;cwd:string;payload:any;signal:AbortSignal;
  active?:{persistenceContext:any}}){
  const ctx:any=new Context(),reader:any=new Context();let history:any;
  try{
    let provider=options.active?.persistenceContext.sessionPersistence;
    if(provider)await provider.flush();
    else{
      await reader.plugin(Persistence,{root:path.join(options.dataDir,'sessions'),compression:'none'});
      provider=reader.sessionPersistence;
    }
    await ctx.plugin(Sessions);await ctx.plugin(Projections);
    class ReadOnly extends SessionPersistence{
      async create(header:any):Promise<any>{throw new SessionReadOnlyError(header.id,'create');}
      async open(id:any,access:any,input:any={}):Promise<any>{
        options.signal.throwIfAborted();if(access!=='read')throw new SessionReadOnlyError(id,'open');
        return provider.open(id,'read',input);
      }
      async stat(id:any,input:any={}):Promise<any>{return provider.stat(id,input);}
      async list(input:any={}):Promise<any[]>{return provider.list(input);}
      async flush():Promise<void>{throw new Error('复制历史不能写入源任务');}
    }
    await ctx.plugin(ReadOnly);await ctx.plugin(Query,{path:':memory:',openAt:'first-search'});
    ctx.sessionProjections.register(subagentCatalogProjectionDefinition);
    ctx.sessionProjections.register(subagentIdentityProjectionDefinition);
    // Family membership inspects only status, never grants execution rights.
    ctx.provide('agents',{get:()=>undefined});
    await ctx.plugin(Attachments,{dshHome:path.join(options.dataDir,'attachment-home')});
    history=createSessionHistory(ctx,options.rootId,options.cwd);
    const source=await history.request('history-fork-seed',options.payload,options.signal);
    if(source.header.cwd!==options.cwd || (options.payload.address.kind==='session'&&source.header.origin==='subagent'))
      throw new Error('原任务的存档身份或工作目录不匹配');
    return {source,store:ctx.attachments,async dispose(){await history.dispose();await ctx.fiber.dispose();await reader.fiber.dispose();}};
  }catch(error){await history?.dispose();await ctx.fiber.dispose();await reader.fiber.dispose();throw error;}
}
