window.__ModuleLoader__.load({id:'reference-contract-fixture',factory:function(require){const React=require('react');return {inject:['inputTriggers','slots'],apply(ctx){
const previews=new Map(),listeners=new Set();const changed=()=>{for(const fn of listeners)fn();};
async function read(ref,signal){const split=ref.lastIndexOf(':');const sessionId=ref.slice(0,split),mode=ref.slice(split+1).replace('ref-','');
 const response=await fetch('/api/reference-contract-fixture/read?sessionId='+encodeURIComponent(sessionId)+'&mode='+mode,{signal});const body=await response.json();if(!response.ok)throw new Error(body.error);return body.text;}
ctx.effect(()=>ctx.inputTriggers.registerSource({name:'real-reference-samples',trigger:'@',order:-100,
 candidates:async(_s,r)=>[{name:'ref-file',label:'真实资料引用'},{name:'ref-fail',label:'读取失败引用'},{name:'ref-wait',label:'等待资料引用'}].filter(c=>c.name.includes(r.query)),
 onPick:p=>({insert:{source:'real-reference-samples',ref:p.session.sessionId+':'+p.candidate.name,label:p.candidate.label,clipboardText:'@'+p.candidate.name,appearance:'file'}}),
 openReference:(s,ref)=>{if(!ref.ref.startsWith(s.sessionId+':'))return false;previews.set(s.sessionId,'正在读取实际资料');changed();read(ref.ref).then(text=>{previews.set(s.sessionId,text);changed();},error=>{previews.set(s.sessionId,error.message);changed();});return true;},
 codec:{clipboardText:ref=>'@'+ref.split(':').at(-1),serialize:read}
}));
ctx.slots.register({name:'conversation.input.overlay',id:'reference-preview',inject:sessionId=>({sessionId})},function(props){
const text=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>previews.get(props.sessionId)||'');if(!text)return null;
return React.createElement('div',{role:'dialog','aria-label':'实际引用资料',style:{position:'fixed',top:'20%',left:'32%',width:'min(520px,60vw)',padding:20,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,zIndex:2000}},
React.createElement('button',{onClick:()=>{previews.delete(props.sessionId);changed();}},'关闭资料预览'),React.createElement('pre',{style:{whiteSpace:'pre-wrap'}},text));});
}};}});
