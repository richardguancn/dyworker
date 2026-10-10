import {useCallback,useEffect,useRef,useState} from 'react';
export function ModsPluginsPage({sessionId}:{sessionId?:string}){
 const [data,setData]=useState<any>({entries:[],catalog:[]}),[view,setView]=useState('installed'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [configs,setConfigs]=useState<Record<string,any>>({});const bridge=window.dyworker!;
 const refresh=useCallback(async()=>{try{setData(await bridge.modsList());}catch(error:any){setError(error.message);}},[bridge]);useEffect(()=>{void refresh();},[refresh]);
 const run=async(action:()=>Promise<any>)=>{setBusy(true);setError('');try{const result=await action();if(result?.ok===false)throw new Error(result.error);await refresh();}catch(error:any){setError(String(error.message||error));}finally{setBusy(false);}};
 const installed=new Map(data.entries.map((row:any)=>[row.id,row]));const rows=(view==='installed'?data.entries:data.catalog).filter((row:any)=>[row.name,row.summary,row.description,row.category].join(' ').includes(query));
 return <section className="plugins-page mods-page"><header className="plugins-page-header"><div><h1>Claude Mods</h1><p>按需添加已验证的任务辅助功能。</p></div>
  <button disabled={busy} onClick={()=>void run(async()=>{const directory=await bridge.modsChooseDirectory();if(!directory)return;const check=await bridge.modsCheck(directory);if(!check.ok)throw new Error(check.errors.join('；'));return bridge.modsInstall({directory});})}>从文件夹添加</button></header>
  <div className="plugins-navigation" role="tablist" aria-label="模组列表"><button role="tab" aria-selected={view==='installed'} onClick={()=>setView('installed')}>已安装 <span>{data.entries.length}</span></button><button role="tab" aria-selected={view==='available'} onClick={()=>setView('available')}>可安装 <span>{data.catalog.length}</span></button></div>
  <label className="plugins-market-search"><input aria-label="搜索模组" placeholder="搜索模组名称或功能" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  {error&&<p className="plugin-row-error" role="alert">{error}</p>}{busy&&<p role="status">正在处理…</p>}<p className="plugins-catalog-notice">{data.scope}</p>
  {rows.map((row:any)=>{const catalog=data.catalog.find((item:any)=>item.id===row.id);return <article className="plugin-card" key={row.id}><div className="plugin-card-body">
   <div className="plugin-card-title"><strong>{row.name}</strong><span className="plugin-tag">v{row.version}</span><span className="plugin-tag">{view==='available'?'已验证':row.disabled?'已停用':row.error?'启动失败':'已启用'}</span></div>
   <p>{row.summary||row.description}</p>{row.error&&<p role="alert">{row.error}</p>}
   <details><summary>设置和说明</summary><p>{catalog?.scope||'本地安装的模组，具体功能以实际运行结果为准。'}</p><p>开源许可：{row.license||catalog?.license} · {catalog?.author||'本地模组'}</p>
    {catalog?.source&&<a href={catalog.source} target="_blank" rel="noreferrer">查看来源</a>}
    {view==='installed'&&Object.entries(row.config||{}).map(([key,value])=><label className="mods-setting" key={key}>{key==='folder'?'原始资料目录':key}
     {typeof value==='boolean'?<input type="checkbox" checked={configs[row.id]?.[key]??value} onChange={event=>setConfigs(current=>({...current,[row.id]:{...row.config,...current[row.id],[key]:event.target.checked}}))}/>
      :<input type={typeof value==='number'?'number':'text'} value={configs[row.id]?.[key]??String(value)} onChange={event=>setConfigs(current=>({...current,[row.id]:{...row.config,...current[row.id],[key]:typeof value==='number'?Number(event.target.value):event.target.value}}))}/>}
    </label>)}
    {view==='installed'&&Object.keys(row.config||{}).length>0&&<button disabled={busy} onClick={()=>void run(()=>bridge.modsConfigure({id:row.id,config:configs[row.id]||row.config}))}>保存设置</button>}
   </details>
   {view==='installed'&&row.id==='office-activity'&&!row.disabled&&<button disabled={busy||!sessionId} onClick={()=>void run(()=>bridge.modsAction({sessionId:sessionId!,id:row.id,command:'activity'}))}>查看当前任务活动</button>}
  </div>{view==='available'?<button disabled={busy||installed.has(row.id)} onClick={()=>void run(()=>bridge.modsInstall({catalogId:row.id}))}>{installed.has(row.id)?'已安装':'安装'}</button>
   :<div className="plugin-card-tools"><button disabled={busy} role="switch" aria-checked={!row.disabled} aria-label={`${row.disabled?'启用':'停用'} ${row.name}`} onClick={()=>void run(()=>bridge.modsEnable({id:row.id,enabled:!!row.disabled}))}>{row.disabled?'启用':'停用'}</button><button disabled={busy} onClick={()=>void run(()=>bridge.modsUninstall(row.id))}>卸载</button></div>}</article>;})}
  {!rows.length&&<p className="plugins-empty">{query?'没有找到匹配的模组。':'还没有安装模组，可以在“可安装”中选择。'}</p>}
 </section>;
}
function Element({node,onAction}:{node:any;onAction:(event:string,id:string,value?:any)=>void}):any{
 if(node===null||node===undefined||typeof node==='boolean')return null;if(typeof node==='string'||typeof node==='number')return String(node);
 if(Array.isArray(node))return node.map((child,index)=><Element key={index} node={child} onAction={onAction}/>);
 const props=node.props||{};const content=<Element node={props.children} onAction={onAction}/>;
 if(node.type==='Text'||node.type==='Markdown')return <span style={{fontWeight:props.bold?600:undefined,opacity:props.dimColor ? 0.65 : 1}}>{node.type==='Markdown'?props.text:content}</span>;
 if(node.type==='Button')return <button onClick={()=>onAction('ui.press',props.onPress)} disabled={props.disabled||!props.onPress}>{props.label||content}</button>;
 if(node.type==='Input')return <label>{props.label}<input defaultValue={props.value||''} placeholder={props.placeholder} onBlur={event=>props.onInput&&onAction('ui.input',props.onInput,event.target.value)} onKeyDown={event=>event.key==='Enter'&&props.onSubmit&&onAction('ui.input',props.onSubmit,event.currentTarget.value)}/></label>;
 if(node.type==='Select')return <label>{props.label}<select defaultValue={props.value} onChange={event=>onAction('ui.select',props.onSelect,event.target.value)}>{(props.options||[]).map((option:any)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
 if(node.type==='Box')return <div className="mods-box" style={{flexDirection:props.flexDirection==='row'?'row':'column',gap:props.gap?8:0}}>{content}</div>;
 return <span>此模组使用了尚未支持的显示内容。</span>;
}
export function ModsPanelView({sessionId}:{sessionId?:string}){
 const [data,setData]=useState<any[]>([]),[error,setError]=useState('');const generation=useRef(0);const bridge=window.dyworker!;
 useEffect(()=>{const current=++generation.current;setData([]);setError('');if(!sessionId||!bridge?.modsSnapshot)return;let stopped=false,running=false;
  const refresh=async()=>{if(running)return;running=true;try{const value=await bridge.modsSnapshot({sessionId});if(!stopped&&current===generation.current){setData(value);setError('');}}catch(error:any){if(!stopped&&current===generation.current)setError(error.message);}finally{running=false;}};
  void refresh();const timer=setInterval(()=>void refresh(),1200);return()=>{stopped=true;clearInterval(timer);};
 },[sessionId,bridge]);
 const action=async(id:string,event:string,actionId:string,value?:any)=>{const current=generation.current;setError('');try{await bridge.modsAction({sessionId:sessionId!,id,event,actionId,value});const next=await bridge.modsSnapshot({sessionId:sessionId!});if(current===generation.current)setData(next);}catch(error:any){if(current===generation.current)setError(error.message);}};
 const visible=data.filter(row=>row.views?.length||row.status||row.error||row.logs?.length);
 if(!visible.length&&!error)return null;
 return <section className="mods-panels" aria-label="任务模组">{error&&<p role="alert">{error}</p>}{visible.map(row=><div key={row.id} className="mods-panel">
  {(row.views?.length>0||row.status||row.error||row.logs?.length>0)&&<strong>{row.name}</strong>}{row.error&&<p role="alert">{row.error}</p>}{row.status&&<p>{row.status}</p>}{row.logs?.length>0&&<p role="status">{row.logs[row.logs.length-1]}</p>}
  {row.estimated&&row.id==='token-weather'&&<small>上下文读数为估算值</small>}
  {row.views.map((view:any)=><div key={view.id}><Element node={view.tree} onAction={(event,id,value)=>void action(row.id,event,id,value)}/></div>)}
 </div>)}</section>;
}
