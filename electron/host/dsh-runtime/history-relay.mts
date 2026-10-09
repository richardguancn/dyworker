/** Renderer-owned handles cannot be borrowed by a different window or a reloaded page. */
export function createHistoryRelay(request: (rootId: string, action: string, payload: any, options?: any) => Promise<any>) {
  const owners = new Map<any, {closed:boolean; controller:AbortController; streams:Map<string,string>; searches:Map<string,AbortController>; catalogs:Map<string,AbortController>; stop:()=>void}>();
  function owner(sender: any) {
    let scope = owners.get(sender);
    if (scope) return scope;
    const controller = new AbortController();
    const retained = {closed:false,controller,streams:new Map<string,string>(),searches:new Map<string,AbortController>(),catalogs:new Map<string,AbortController>(),stop:()=>{}};
    const retire = () => {
      if (retained.closed) return;
      retained.closed = true; controller.abort(new Error('历史读取所属页面已关闭'));
      if (owners.get(sender) === retained) owners.delete(sender);
      retained.stop();
      for (const [streamId, rootId] of retained.streams) void request(rootId,'history-close',{streamId}).catch(()=>{});
      retained.streams.clear();
      retained.searches.clear();retained.catalogs.clear();
    };
    const navigate = (details:any) => { if (details.isMainFrame && !details.isSameDocument) retire(); };
    sender.on('destroyed',retire); sender.on('render-process-gone',retire); sender.on('did-start-navigation',navigate);
    retained.stop = () => {
      sender.removeListener('destroyed',retire);sender.removeListener('render-process-gone',retire);sender.removeListener('did-start-navigation',navigate);
    };
    owners.set(sender,retained);
    return retained;
  }
  return {
    async request(sender:any, rootId:string, action:string, payload:any) {
      if (sender.isDestroyed?.()) throw new Error('历史读取所属窗口已经关闭');
      const scope = owner(sender);
      if(action==='global-search-cancel'||action==='global-list-cancel'){
        const search=action==='global-search-cancel',map=search?scope.searches:scope.catalogs;
        const controller=map.get(search?payload.searchId:payload.listId);
        if(!controller)return false;
        controller.abort(new Error(search?'此跨任务搜索已取消':'此任务目录读取已取消'));return true;
      }
      if(action==='global-search'||action==='global-list'){
        const search=action==='global-search',map=search?scope.searches:scope.catalogs,id=search?payload.searchId:payload.listId;
        if(typeof id!=='string'||!id||id.length>128||map.has(id))
          throw new Error(search?'跨任务搜索身份缺失或重复':'任务目录读取身份缺失或重复');
        const controller=new AbortController();map.set(id,controller);
        try{
          const signal=AbortSignal.any([scope.controller.signal,controller.signal]);
          const value=await request(rootId,action,search?{query:payload.query}:{},{signal});
          signal.throwIfAborted();return value;
        }finally{if(map.get(id)===controller)map.delete(id);}
      }
      if (action === 'history-next' || action === 'history-close') {
        if (scope.streams.get(payload.streamId) !== rootId) throw new Error('此历史订阅不属于当前页面和任务');
        if (action === 'history-close') scope.streams.delete(payload.streamId);
      }
      const result = await request(rootId,action,payload,{signal:scope.controller.signal});
      if (action === 'history-open' || action === 'history-control-open') {
        if (scope.closed) { await request(rootId,'history-close',{streamId:result.streamId}).catch(()=>{}); throw new Error('历史读取所属页面已经关闭'); }
        scope.streams.set(result.streamId,rootId);
      }
      if (action === 'history-next' && result.done) scope.streams.delete(payload.streamId);
      return result;
    },
    async dispose() {
      const pending:Promise<any>[] = [];
      for (const scope of owners.values()) {
        scope.closed=true;scope.controller.abort(new Error('历史读取入口已关闭'));scope.stop();
        for (const [streamId,rootId] of scope.streams) pending.push(request(rootId,'history-close',{streamId}).catch(()=>{}));
        scope.streams.clear();
        scope.searches.clear();scope.catalogs.clear();
      }
      owners.clear(); await Promise.all(pending);
    },
  };
}
