window.__ModuleLoader__.load({id:'command-attachment-fixture',factory:function(require){const React=require('react');return {inject:['inputTriggers','slots','sessions'],apply(ctx){
 const records=new Map(),listeners=new Set();
 const claim=id=>({name:'check-attachments',token:'/check-attachments ',attachments:true,hint:'实际读取附件，可用 fail 检查失败、wait 检查等待',submit:async(args,actx,attachments)=>{
 if(actx!==ctx.sessions.scope(id))return {kind:'error',text:'命令所属会话不符'};
 const response=await fetch('/api/command-attachment-fixture/execute?sessionId='+encodeURIComponent(id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:id,args,attachments})});
 const result=await response.json();if(!response.ok)return {kind:'error',text:result.error||'命令接口失败'};
 records.set(id,result.text);for(const listener of listeners)listener();return {kind:result.kind,text:result.kind==='success'?'已实际读取 '+attachments.length+' 个附件':result.text};}});
 ctx.effect(()=>ctx.inputTriggers.registerSource({name:'真实附件验收',trigger:'/',order:-100,candidates:async()=>[{name:'check-attachments',label:'读取实际附件'}],onPick:pick=>({claim:claim(pick.session.sessionId)}),
 matchEnter:async(s,line)=>/^\/check-attachments(?:\s|$)/.test(line)?{claim:claim(s.sessionId)}:undefined}));
 ctx.slots.register({name:'conversation.input.overlay',id:'command-attachment-proof',inject:id=>({sessionId:id})},function(props){const text=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>records.get(props.sessionId)||'尚未读取附件');return React.createElement('p',{'data-command-attachment-proof':'true',style:{fontSize:12,margin:'4px 12px',maxHeight:100,overflow:'auto'}},text);});
}};}});
