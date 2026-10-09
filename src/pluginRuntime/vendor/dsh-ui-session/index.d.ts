import {Service, type Context} from '@deepseek-ai/cordis';
export class SlotRegistry extends Service {
  constructor(ctx:Context);
  provideRoot(contribution:any):()=>void;
  installScope(scope:string,adapter:any):void;
  bindStoreScope(binding:{key:string;ctx:Context}):void;
}
export class UiSession extends Service {
  constructor(ctx:Context,sessions:any);
  readonly adapter:{current:any;bindingSource:(reference:any)=>any;renderArea:(binding:any,props:any)=>any};
  readonly sessionStatus:{getSnapshot:()=>ReadonlyMap<string,{running:boolean|undefined;pendingInteraction:any;completionUnread:boolean}>;subscribe:(listener:()=>void)=>()=>void};
  bindingSource(reference:any):any;
  provide(descriptor:any):()=>void;
  registerPendingInteraction(precedence:(interaction:any)=>number):(interaction:any,delegate:()=>Promise<void>)=>()=>void;
}
