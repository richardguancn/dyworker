import vm from 'node:vm';
// 此进程只执行编译后的模块。Node 权限、进程终止与凭据清理由父进程负责。
const pending=new Map<string,any>();let serial=0,context:any;
const bridge=(text:string,resolve:any,reject:any)=>{const id=String(++serial);pending.set(id,{resolve,reject});process.send?.({type:'rpc',id,...JSON.parse(text)});};
Object.setPrototypeOf(bridge,null);
process.on('message',async(message:any)=>{
  if(message.type==='reply'){const item=pending.get(message.id);pending.delete(message.id);if(item)message.error?item.reject(message.error):item.resolve(JSON.stringify(message.value??null));return;}
  if(message.type==='init'){
    try{
      context=vm.createContext({__bridge:bridge,__initial:JSON.stringify(message.input)}, {codeGeneration:{strings:false,wasm:false}});
      const factories=Object.entries(message.input.modules).map(([key,item]:any)=>`${JSON.stringify(key)}:function(exports,require,module,h,Fragment){${item.code}\n}`).join(',');
      new vm.Script(`const __factories={${factories}};`).runInContext(context,{timeout:1000});
      new vm.Script(bootstrap).runInContext(context,{timeout:1000});
      new vm.Script(`__loadInitial()`).runInContext(context,{timeout:1000});
      process.send?.({type:'ready'});
    }catch(error:any){process.send?.({type:'error',error:error.message});}return;
  }
  if(message.type==='dispatch'){
    try{context.__request=JSON.stringify(message);const value=await new vm.Script('__dispatch(JSON.parse(__request))').runInContext(context,{timeout:1000});
      process.send?.({type:'result',id:message.id,value:JSON.parse(JSON.stringify(value??null))});
    }catch(error:any){process.send?.({type:'result',id:message.id,error:error.message});}
  }
});
const bootstrap=String.raw`
const initial=JSON.parse(__initial),handlers=[],cache={},timers=new Set();
const allowedEvents=new Set(initial.events),allowedMethods=new Set(initial.methods);
const actions=new Map();let actionSeq=0;
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const rpc=(method,args=[],dispatchId)=>new Promise((resolve,reject)=>__bridge(JSON.stringify({method,args,dispatchId}),
 text=>resolve(JSON.parse(text)),text=>reject(new Error(text))));
const h=(type,props,...children)=>{const result={type,props:{...(props||{})}};if(children.length)result.props.children=children.flat();
 for(const key of ['onPress','onInput','onSubmit','onSelect'])if(typeof result.props[key]==='function'){const id=initial.identity+'-'+(++actionSeq);actions.set(id,result.props[key]);result.props[key]=id;}
 while(actions.size>1000)actions.delete(actions.keys().next().value);
 return result;};
const Fragment='Box';
const elements=Object.fromEntries(initial.elements.map(name=>[name,props=>h(name,props)]));
function matching(filter,input){return !filter||Object.entries(filter).every(([key,wanted])=>{
 const value=input?.[key];if(wanted instanceof RegExp){wanted.lastIndex=0;return wanted.test(String(value??''));}
 if(Array.isArray(wanted))return wanted.includes(value);if(wanted&&typeof wanted==='object')return matching(wanted,value);return wanted===value;});}
function on(event,filter,handler){if(typeof filter==='function'){handler=filter;filter=null;}
 if(!allowedEvents.has(event))throw new Error('不支持事件 '+event);if(typeof handler!=='function')throw new Error('事件没有处理函数');
 const row={event,filter,handler,catcher:null};handlers.push(row);return {catch(fn){row.catcher=fn;return this;}};}
function load(key){if(cache[key])return cache[key].exports;const module={exports:{}};cache[key]=module;
 const definition=initial.modules[key];if(!definition)throw new Error('导入未声明的模块');
 const require=spec=>{const target=definition.imports[spec];if(target===null)return {};if(!target)throw new Error('禁止导入 '+spec);return load(target);};
 // 模块包装由父进程预先编译、执行；这里调用已经建立的工厂。
 __factories[key](module.exports,require,module,h,Fragment);return module.exports;}
function __loadInitial(){const exported=load(initial.entry);if(typeof exported.register!=='function')throw new Error('模组未导出 register');
 const value=exported.register(on,freeze(initial.options));if(value&&typeof value.then==='function')throw new Error('register 必须同步登记事件');}
function api(dispatchId){const value={plugin:{name:initial.name,root:initial.root}};
 for(const method of allowedMethods){const [namespace,name]=method.split('.');value[namespace]??={};
 if(namespace==='plugin')continue;
 value[namespace][name]=(...args)=>rpc(method,args,dispatchId);}
 value.ui.resolve=()=>elements;value.clock.now=()=>rpc('clock.now',[],dispatchId);
 for(const name of ['after','every'])value.clock[name]=(ms,fn)=>{
 if(typeof fn!=='function')throw new Error('计时器需要回调函数');const id='timer-'+(++actionSeq);actions.set(id,fn);
 const registered=rpc('clock.'+name,[ms,id],dispatchId);return {cancel:()=>registered.then(()=>rpc('clock.cancel',[id],dispatchId))};};
 return freeze(value);}
async function __dispatch(request){const $=api(request.id),input=freeze(request.input),rows=handlers.filter(row=>row.event===request.event&&matching(row.filter,input));
 const run=async(index,e)=>{if(index===rows.length)return rpc('next',[e],request.id);
 const row=rows[index];let called=false,result,continuation;
 const next=async changed=>{called=true;continuation=run(index+1,freeze(changed));result=await continuation;return result;};
 // 取消由宿主终止所属进程；不把主机对象或主机函数原型传入代码环境。
 next.signal=freeze({aborted:false,reason:undefined,addEventListener(){},removeEventListener(){},throwIfAborted(){}});next.origin=freeze({plugin:'engine',tier:'core'});next.budget=freeze({ms:10000,remainingMs:10000});
 try{return await row.handler($,e,next);}catch(error){if(row.catcher){next.error={kind:'throw',message:error.message};next.called=called;return row.catcher($,e,next);}
 await rpc('fault',[request.event,error.message],request.id);if(called)return continuation;return next(e);}};
 if(request.event.startsWith('ui.')&&request.input.actionId){const action=actions.get(request.input.actionId);
 if(!action)throw new Error('按钮已过期，请重新打开面板');return action(request.input.value);}
 return run(0,input);}
`;
