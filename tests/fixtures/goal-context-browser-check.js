// 仅用于独立的本地预览页面，会替换模拟数据与桌面桥接。
// 启动 Vite 后：agent-browser eval --stdin < tests/fixtures/goal-context-browser-check.js
(async () => {
const {useSessionStore:S}=await import('/src/state/sessionStore.ts');
const {useSettingsStore:T}=await import('/src/state/settingsStore.ts');
const refs=await import('/src/state/sharedRefs.ts');
const {startGoal}=await import('/src/goal.ts');
const {sendMessage}=await import('/src/state/sendMessageActions.ts');
const listeners=new Set();let mode='response';let request;
window.dyworker={platform:'darwin',listMemories:async()=>[],listSkills:async()=>[],listPendingWakes:async()=>[],saveSessions:async()=>({ok:true}),onAgentEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb)},sendTask:async p=>{
if(mode==='error')throw new Error('模拟发送失败');request=p;const emit=event=>{for(const cb of listeners)cb({sessionId:p.sessionId,runId:p.runId,event})};
emit({type:'queue-start',count:0});
emit({type:'context-usage',used:970000,completion:0,estimated:false});
emit({type:'token-usage',prompt:970000,completion:100,model:'k3',estimated:false});
emit({type:'context-compacted'});
emit({type:'context-usage',used:12000,completion:0,estimated:true});
const result={status:'done',goalAchieved:true,finalText:'检查完成。'};
if(mode==='next-running'){refs.runningRunIdsRef.current.set(p.sessionId,'next-run');}
if(mode==='event'||mode==='queued-finished'||mode==='next-running')emit({type:'agent-finished',result});
return mode.startsWith('queued')?{ok:true,queued:true}:{ok:true,result};
}};
T.getState().setSettings(s=>({...s,identity:'personal',endpoint:'https://example.test/v1/chat/completions',model:'k3',apiKey:'test'}));
refs.playCompletionSoundRef.current=()=>{};refs.refreshMemoriesRef.current=async()=>{};
const checks=[];
for(const variant of ['response','event','queued-finished','queued-running','next-running','error']){
 mode=variant;
 const session={id:'check-'+variant,title:'压缩与目标完成验证',workspacePath:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],...startGoal('完成检查')};
 S.getState().setSessions([session]);S.getState().setNewTaskDraft(null);S.getState().setActiveId(session.id);refs.sessionsRef.current=[session];refs.activeIdRef.current=session.id;
 await new Promise(r=>setTimeout(r,50));await sendMessage('完成检查',session.id);await new Promise(r=>setTimeout(r,100));
 const final=S.getState().sessions.find(s=>s.id===session.id);
 const result={variant,status:final.goalState.status,running:S.getState().runningSessionIds.has(session.id),used:final.contextTokens,requests:final.tokenStats?.requests,notes:final.messages.filter(m=>m.role==='assistant').flatMap(m=>m.activities||[]).filter(a=>a.title==='上下文已压缩').length,banner:!!document.querySelector('.goal-banner'),stop:!!document.querySelector('[aria-label="停止当前任务"]')};
 if(variant==='error'){if(result.running||result.status!=='blocked')throw new Error(JSON.stringify(result));}
 else if(variant==='queued-running'){if(!result.running||result.status!=='active'||refs.runningRunIdsRef.current.get(session.id)!==request.runId)throw new Error(JSON.stringify(result));}
 else if(variant==='next-running'){if(!result.running||refs.runningRunIdsRef.current.get(session.id)!=='next-run'||result.banner)throw new Error(JSON.stringify(result));refs.runningRunIdsRef.current.delete(session.id);}
 else if(result.status!=='complete'||result.running||result.used!==12000||result.requests!==1||result.notes!==1||result.banner||result.stop)throw new Error(JSON.stringify(result));checks.push(result);
 if(variant==='queued-running'){for(const cb of listeners)cb({sessionId:request.sessionId,runId:request.runId,event:{type:'agent-finished',result:{status:'done',goalAchieved:true,finalText:'检查完成。'}}});}
}
return checks;
})()
