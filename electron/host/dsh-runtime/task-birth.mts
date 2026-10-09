import {Context} from '@deepseek-ai/cordis';
import Sessions from '@deepseek-ai/dsh-session';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Attachments, {commitPreparedImageFile} from '@deepseek-ai/dsh-attachment-local';
import {RemoteError} from '@deepseek-ai/dsh-typert-protocol';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {referencedImage} from './vendor/referenced-image.mts';
import {visibleDshTurns} from './visible-turns.mts';

// Workspace IDs are the actual paths published by the native workspace catalog.
export const dshWorkspaceId=(cwd:string)=>cwd;

/** Persist first; native publication is the commit. No Agent/model is created. */
export async function birthDshTask(options:{
  dir:string; archive:any; request:any; defaultSessionId?:string; signal:AbortSignal;
  fork?:{header:any;seed:any[];inheritedEventCount:number;atSeq:number;store:any};
  sourceRecord?:{id:string;createdAt:string;workspacePath:string};
}){
  const {signal,request,fork}=options;signal.throwIfAborted();
  if(!request||typeof request!=='object'||Array.isArray(request))throw new RemoteError('gateway/bad-request','任务创建格式无效',{});
  if(request.workspaceId!==undefined&&request.cwd!==undefined)throw new RemoteError('gateway/bad-request','session.create accepts workspaceId or cwd, not both',{});
  if(request.sessionId!==undefined&&(typeof request.sessionId!=='string'||!request.sessionId))throw new RemoteError('gateway/bad-request','任务编号无效',{});
  if(request.cwd!==undefined&&(typeof request.cwd!=='string'||!request.cwd))throw new RemoteError('gateway/bad-request','工作目录无效',{});
  if(request.workspaceId!==undefined&&typeof request.workspaceId!=='string')throw new RemoteError('gateway/bad-request','工作区编号无效',{});
  let cwd=fork?.header.cwd;
  if(!fork){
    if(request.workspaceId!==undefined){
      const roots=await options.archive.loadAll();
      cwd=roots.find((row:any)=>row.workspacePath&&dshWorkspaceId(row.workspacePath)===request.workspaceId)?.workspacePath;
      if(!cwd)throw new RemoteError('workspace/not-found' as any,'所选工作区不存在',{workspaceId:request.workspaceId} as any);
    }else cwd=request.cwd||(await options.archive.getAsync(options.defaultSessionId))?.workspacePath;
  }
  if(typeof cwd!=='string'||!cwd)throw new RemoteError('gateway/bad-request','创建任务需要选择工作目录',{});
  cwd=await fs.realpath(cwd);if(!(await fs.stat(cwd)).isDirectory())throw new RemoteError('gateway/bad-request','工作目录不是文件夹',{});
  const id=fork?`session-${randomUUID()}`:request.sessionId??`session-${randomUUID()}`;
  const final=path.join(options.dir,createHash('sha256').update(id).digest('hex'));
  const existing=await options.archive.getAsync(id);
  if(existing){
    if(fork||existing.runtime!=='dsh'||await fs.realpath(existing.workspacePath)!==cwd)
      throw new RemoteError('gateway/bad-request','这个任务编号已被其他任务或工作目录使用',{});
    const reader:any=new Context();
    try{
      await reader.plugin(Persistence,{root:path.join(final,'sessions'),compression:'none'});
      const stored=await reader.sessionPersistence.stat(id,{signal});
      if(stored&&(stored.header.id!==id||stored.header.cwd!==cwd||stored.header.origin==='subagent'))
        throw new RemoteError('gateway/bad-request','这个任务编号的存档身份或工作目录不匹配',{});
    }finally{await reader.fiber.dispose();}
    signal.throwIfAborted();
    return {sessionId:id,nativeSession:existing};
  }
  if(await fs.stat(final).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))
    throw new RemoteError('gateway/bad-request','这个编号已有存档，请使用新任务编号',{});
  await fs.mkdir(options.dir,{recursive:true});
  const staging=await fs.mkdtemp(path.join(options.dir,'.creating-'));
  const ctx:any=new Context();let published=false,installed=false;
  try{
    await ctx.plugin(Sessions);await ctx.plugin(Persistence,{root:path.join(staging,'sessions'),compression:'none'});
    await ctx.plugin(Attachments,{dshHome:path.join(staging,'attachment-home')});
    const blank=ctx.sessions.create(id,{meta:{cwd}});
    const header=fork?{...blank.header,parentSession:fork.header.id,isSeeded:true,
      ...(fork.header.agentPreset?{agentPreset:fork.header.agentPreset}:{})}:blank.header;
    const seed=fork?.seed??[];
    if(fork){
      const references=new Map<string,any>();
      function collect(value:any){
        if(!value||typeof value!=='object')return;
        if(typeof value.attachmentId==='string'&&typeof value.bytes==='number'){
          if(value.mediaType&&referencedImage(seed,value.attachmentId))references.set(`image:${value.attachmentId}`,referencedImage(seed,value.attachmentId));
          else if(!value.mediaType&&typeof value.name==='string')references.set(`file:${value.attachmentId}:${value.name}`,value);
        }
        for(const child of Object.values(value))collect(child);
      }
      collect(seed);
      for(const [kind,ref] of references){
        signal.throwIfAborted();
        if(kind.startsWith('image:')){
          const original=await fork.store.readImage(ref,signal);
          await commitPreparedImageFile(ctx.attachments.root,{ref,data:original.data});
          await ctx.attachments.readImage(ref,signal);
        }else{
          const copied=await ctx.attachments.saveFileStream({name:ref.name,data:fork.store.readFileStream(ref,signal),signal});
          if(!isDeepStrictEqual(copied,ref))throw new Error('复制后的附件与原记录不一致');
        }
      }
    }
    signal.throwIfAborted();
    const handle=await ctx.sessionPersistence.create(header,{...(fork?{inheritedEventCount:fork.inheritedEventCount}:{}),signal});
    try{if(seed.length)await handle.append(seed,{signal});await handle.flush({signal});}finally{await handle.close();}
    const decode=async(message:any)=>({role:'assistant',content:await Promise.all((message.content||[]).filter((part:any)=>['text','image','image_url'].includes(part.type)).map(async(part:any)=>{
      if(part.type==='text')return {type:'text',text:part.text};
      if(part.type==='image_url')return part;
      const image=await ctx.attachments.readImage(part.attachment,signal);return {type:'image_url',image_url:{url:`data:${part.attachment.mediaType};base64,${Buffer.from(image.data).toString('base64')}`}};
    }))});
    const turns=await visibleDshTurns(seed,decode),messages:any[]=[];
    for(const turn of turns){
      const original=seed.find(event=>event.type==='user/message'&&event.data.id===turn.user.id)?.data;
      const attachments:any[]=[],dshAttachments:any[]=[];
      for(const part of original?.content||[]){
        if(part.type==='file')attachments.push({name:part.attachment.name,path:ctx.attachments.fileHostPath(part.attachment),size:part.attachment.bytes,mimeType:'application/octet-stream'});
        if(part.type==='image'){
          const image=await ctx.attachments.readImage(part.attachment,signal);
          // Official normalized objects have digest paths without extensions;
          // native local-image lookup deliberately accepts named image files.
          // Use the existing DSH byte presentation, preserving the original
          // reference in the official log and its copied immutable object.
          dshAttachments.push({type:'image',mediaType:part.attachment.mediaType,data:Buffer.from(image.data).toString('base64'),name:part.attachment.name||'图片'});
        }
      }
      messages.push({id:turn.user.id,role:'user',content:turn.user.text,createdAt:turn.user.createdAt,dshMessageId:turn.user.id,
        ...(attachments.length?{attachments}:{}),...(dshAttachments.length?{dshAttachments}:{} )});
      if(turn.replies.length)messages.push({id:`${id}:${turn.user.id}`,role:'assistant',content:turn.replies.map((reply:any)=>reply.text).filter(Boolean).join('\n\n'),
        createdAt:turn.replies.at(-1).createdAt,dshTurnId:turn.user.id,dshMessageId:turn.replies[0].id,executedMessages:turn.replies.flatMap((reply:any)=>reply.executedMessages),taskStatus:'done'});
    }
    const title=[...seed].reverse().find(event=>event.type==='session/title')?.data.title||'新任务';
    const createdAt=new Date(header.createdAt).toISOString();
    const record:any={id,runtime:'dsh',title,workspacePath:cwd,createdAt,updatedAt:createdAt,messages,
      ...(fork?{parentSessionId:fork.header.id,dshForkAtSeq:fork.atSeq}:{})};
    // Paths in native presentation must name the committed data directory.
    for(const message of messages)for(const attachment of message.attachments||[])attachment.path=path.join(final,path.relative(staging,attachment.path));
    await ctx.fiber.dispose();signal.throwIfAborted();
    await fs.rename(staging,final);installed=true;
    try{await options.archive.publishDshTask(record,options.sourceRecord,signal);published=true;}
    catch(error){
      // A writer may report a late durability error after publishing. Preserve
      // the matching real row and log; do not erase a task already observable.
      const current=await options.archive.getAsync(id);
      if(current?.runtime==='dsh'&&current.createdAt===record.createdAt)published=true;
      throw error;
    }
    return {sessionId:id,nativeSession:record};
  }finally{
    try{await ctx.fiber.dispose();}finally{if(!published)await fs.rm(installed?final:staging,{recursive:true,force:true});}
  }
}
