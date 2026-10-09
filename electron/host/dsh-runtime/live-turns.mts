import { randomUUID } from 'node:crypto';
import { visibleDshTurns } from './visible-turns.mts';

/** Official messages and explicitly partial provider output are separate sources. */
export function createLiveDshTurns(decodeAssistant: (message:any)=>Promise<any>, emit:(turns:any[])=>void) {
  const events:any[]=[];
  const decoded=new Map<string,Promise<any>>();
  let pending:any, revision=0, closed=false, publishing:Promise<void>|undefined;
  const decode=(message:any)=> {
    let value=decoded.get(message.id);
    if (!value) { value=decodeAssistant(message); decoded.set(message.id,value); }
    return value;
  };
  const snapshot=async()=> {
    const raw=events.slice(), partial=pending && {...pending};
    const turns=await visibleDshTurns(raw,decode);
    if (partial) {
      const turn=turns.find(turn=>turn.user.id===partial.userId);
      if (turn) turn.replies.push({id:partial.id,text:partial.text,reasoning:partial.reasoning,
        createdAt:partial.createdAt,partial:true,executedMessages:[]});
    }
    return turns;
  };
  const publish=()=> {
    revision++;
    if (closed || publishing) return;
    publishing=(async()=> {
      let seen=-1;
      while (!closed && seen!==revision) {
        seen=revision;
        const turns=await snapshot();
        if (!closed && seen===revision && turns.length) emit(turns);
      }
    })().finally(()=>{publishing=undefined;});
    // The final snapshot propagates decoding errors; live observation must not cause unhandled rejection.
    void publishing.catch(()=>{});
  };
  return {
    event(event:any) {
      if (closed || !['user/message','assistant/message'].includes(event.type)) return;
      events.push(event);
      if (event.type==='assistant/message' || (event.type==='user/message' && event.data?.source?.kind==='user')) pending=undefined;
      publish();
    },
    start(request:any) {
      if (closed) return undefined;
      const user=[...(request.messages||[])].reverse().find((message:any)=>message.source?.kind==='user');
      // An imported/injected/provider-created user is never a new application turn.
      if (!user || !events.some(event=>event.type==='user/message' && event.data?.id===user.id && event.data.source?.kind==='user')) return undefined;
      const id=randomUUID();
      pending={id,userId:user.id,text:'',reasoning:'',createdAt:new Date().toISOString()}; publish(); return id;
    },
    text(id:string|undefined,text:string) {if (!closed && id && pending?.id===id) {pending.text=text;publish();}},
    reasoning(id:string|undefined,reasoning:string) {if (!closed && id && pending?.id===id) {pending.reasoning=reasoning;publish();}},
    async seal() { closed=true; await publishing?.catch(()=>{}); return snapshot(); },
  };
}
