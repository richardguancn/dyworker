import fs from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
export const name='reference-contract-fixture';export const inject=['connection'];
export function apply(ctx){ctx.effect(()=>ctx.connection.fetch.register({path:'/api/reference-contract-fixture/read',methods:['GET'],fetch:async request=>{
 const u=new URL(request.url);const mode=u.searchParams.get('mode');
 if(mode==='fail')return Response.json({error:'验收插件实际拒绝读取资料'},{status:404});
 if(mode==='wait')await setTimeout(5000,undefined,{signal:request.signal});
 const text=await fs.readFile(new URL('./fixture-note.txt',import.meta.url),'utf8');request.signal.throwIfAborted();
 return Response.json({text});
}}));}
