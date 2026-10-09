import { errorChain } from '@deepseek-ai/dsh-llm';

/** Carry the original projection stream and original API event arguments on one addressed read lifetime. */
export async function* followSessionControl(ctx:any, control:any, list:any, address:any, signal:AbortSignal,scopeIds:()=>Promise<Set<string>>) {
  let ids = await scopeIds();
  const listed = new Map((await list.list(signal)).filter((row:any) => ids.has(row.sessionId)).map((row:any)=>[row.sessionId,row]));
  signal.throwIfAborted();
  const lifetime = new AbortController(), combined = AbortSignal.any([signal,lifetime.signal]);
  const pending:any[] = [];
  let wake:(()=>void)|undefined, finished=false, failure:any, pump:Promise<void>|undefined;
  const notify=()=>{const resolve=wake;wake=undefined;resolve?.();};
  const push=(value:any)=>{if(!combined.aborted){pending.push(value);notify();}};
  const event=(name:string,...args:any[])=>push({events:[{name,args}]});
  const added=(session:any)=>event('api-session/added',list.summaryFor(session));
  const available=({agent}:any)=>{if(ctx.sessions.get(agent.id)===agent.session)added(agent.session);};
  const stops=[
    ctx.on('session/created',added,{global:true}),
    ctx.on('session/disposed',(session:any)=>event('api-session/removed',session.id),{global:true}),
    ctx.on('agent/created',available,{global:true}),ctx.on('agent/disposed',available,{global:true}),
    ctx.on('agent/status',({agent,status}:any)=>event('api-session/status',agent.id,status==='running'),{global:true}),
    ctx.on('agent/error',({agent,error}:any)=>event('api-session/error',agent.id,errorChain(error)),{global:true}),
    ctx.on('session/event',(session:any,record:any)=>{
      if(record.type==='user/message'&&record.data.source.kind==='user')event('api-session/activity',session.id,record.time);
    },{global:true}),
  ];
  const iterator = control.control(combined)[Symbol.asyncIterator]();
  const abort=()=>{finished=true;notify();};combined.addEventListener('abort',abort,{once:true});
  try {
    const first=await iterator.next();combined.throwIfAborted();
    if(first.done||first.value?.type!=='baseline')throw new Error('会话状态没有返回初始数据');
    // Children created during the initial asynchronous list read must join this cut.
    // Changes after the original baseline remain queued by the original controller.
    ids=await scopeIds();combined.throwIfAborted();
    // Capture latest live summaries synchronously at the publication cut; earlier queued statuses are superseded.
    const events=[...ids].flatMap(id=>{
      const attached=ctx.sessions.get(id), summary=attached ? list.summaryFor(attached) : listed.get(id);
      return summary ? [{name:'api-session/added',args:[summary]}] : [];
    });
    pending.length=0;
    yield {frame:{...first.value,value:{...first.value.value,projections:Object.fromEntries(Object.entries(first.value.value.projections).filter(([id])=>ids.has(id)))}},events};
    pump=(async()=>{
      try {
        while(!combined.aborted) {
          const next=await iterator.next();if(next.done)break;
          push({frame:next.value});
        }
      }catch(error){if(!combined.aborted)failure=error;}
      finally{finished=true;notify();}
    })();
    while(!combined.aborted) {
      const item=pending.shift();
      if(item!==undefined){
        const sessionId=item.frame?.sessionId ?? (item.events[0].name==='api-session/added' ? item.events[0].args[0].sessionId : item.events[0].args[0]);
        let discovered:string[]=[];
        if(!ids.has(sessionId)||item.frame?.key==='subagentCatalog') {
          const refreshed=await scopeIds();
          discovered=[...refreshed].filter(id=>!ids.has(id));
          const removed=[...ids].filter(id=>!refreshed.has(id));ids=refreshed;
          if(discovered.length||removed.length) {
            const listedRows=await list.list(combined);combined.throwIfAborted();
            // Discovery awaits storage. Added/status events queued before this
            // publication cut are older than the actual live summaries below.
            // Replaying an idle creation event afterwards would regress running.
            const staleState=(envelope:any)=>envelope.events?.length&&envelope.events.every((event:any)=>
              (event.name==='api-session/added'||event.name==='api-session/status')&&
              discovered.includes(event.name==='api-session/added'?event.args[0].sessionId:event.args[0]));
            const summaries=listedRows.filter((row:any)=>discovered.includes(row.sessionId)).map((row:any)=>{
              const attached=ctx.sessions.get(row.sessionId);return attached?list.summaryFor(attached):row;
            });
            const latestStatus=new Map<string,any>();
            for(const envelope of [item,...pending])for(const event of envelope.events||[])
              if(event.name==='api-session/status'&&discovered.includes(event.args[0]))latestStatus.set(event.args[0],event);
            const keepStatus=(envelope:any)=>envelope.events?.some((event:any)=>event.name==='api-session/status'&&
              latestStatus.get(event.args[0])===event&&summaries.some((row:any)=>row.sessionId===event.args[0]&&row.running===event.args[1]));
            for(let index=pending.length-1;index>=0;index--)if(staleState(pending[index])&&!keepStatus(pending[index]))pending.splice(index,1);
            yield {events:[...summaries.map((row:any)=>({name:'api-session/added',args:[row]})),...removed.map(id=>({name:'api-session/removed',args:[id]}))]};
            if(staleState(item)&&!keepStatus(item))continue;
          }
        }
        if(ids.has(sessionId))yield item;
        continue;
      }
      if(finished){if(failure)throw failure;return;}
      await new Promise<void>(resolve=>{wake=resolve;});
    }
  } finally {
    lifetime.abort(new Error('会话状态订阅已关闭'));combined.removeEventListener('abort',abort);
    for(const stop of stops)stop();
    await pump;await iterator.return?.();pending.length=0;
  }
}
