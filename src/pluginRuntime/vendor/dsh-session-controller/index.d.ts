import type {Context} from '@deepseek-ai/cordis';
export class Session {
  constructor(sessionId: string, remote: any, options?: any);
  sessionId: string;
  eventSource: {getSnapshot():any; subscribe(listener:()=>void):()=>void};
  projections: {faceOf(key:string):{getSnapshot():any;subscribe(listener:()=>void):()=>void};seed(value:any):void;values():any;subscribeAny(listener:()=>void):()=>void};
  getSnapshot(): any;
  subscribe(listener:()=>void):()=>void;
  open(): Promise<void>;
  loadOlder(): Promise<void>;
  loadThrough(seq:number): Promise<void>;
  dispose(): Promise<void>;
  bindScope(ctx:Context):void;
  unbindScope():void;
  handleRunning(running:boolean):void;
  configureSubagent(address:any,parentAvailable?:boolean):void;
  readAttachment(id:string): Promise<any>;
  prompt(content:any[],mode:'queue'|'steer',signal?:AbortSignal,requestId?:string):Promise<any>;
  updateQueue(id:string,action:any):Promise<any>;
  cancel():Promise<any>;
  command(line:string):Promise<any>;
  rename(title:string):Promise<any>;
}
export class RemoteStream {
  constructor(connection:any,options:any);
  [Symbol.asyncIterator](): AsyncIterator<any>;
  dispose(): Promise<void>;
  restart():void;
}
export class RemoteStreamCarrierError extends Error {}
export class RemoteError extends Error {
  constructor(code:string,message:string,details:any);
  code:string; details:any;
}
export class SessionManager {
  constructor(remote:any);
  resolveTarget(target:any):string;
  get(id:string):Session;
  refreshList():Promise<void>;
  subscribe(listener:()=>void):()=>void;
  getListSnapshot():any;
  handleControlFrame(frame:any):void;
  handleSessionAdded(summary:any):void;
  handleSessionRemoved(id:string):void;
  handleSessionStatus(id:string,running:boolean):void;
  handleSessionActivity(id:string,time:number):void;
  handleSessionError(id:string,message:string):void;
  dispose():Promise<void>;
}
export interface SessionReference {
  readonly sessionId:string;
  readonly binding:{sessionId:string;session:Session;eventSource:Session['eventSource'];ctx:Context};
  readonly ready:Promise<SessionReference['binding']>;
  release():void;
  [Symbol.dispose]():void;
}
export function scopeOf(scope:Context):string|undefined;
export class ClientSessions {
  constructor(ctx:Context,remote:any);
  readonly list:{getSnapshot():any;subscribe(listener:()=>void):()=>void};
  readonly searchResultLimit:number;
  retain(target:any,options:{source:string;signal?:AbortSignal}):SessionReference;
  using<T>(target:any,options:{source:string;signal?:AbortSignal},operation:(reference:SessionReference)=>T|Promise<T>):Promise<T>;
  retainAgentScope(id:string):SessionReference;
  retainInfo(id:string):{getSnapshot():any;subscribe(listener:()=>void):()=>void};
  binding(id:string):SessionReference['binding']|undefined;
  scope(id:string):Context|undefined;
  scopeOf(scope:Context):string|undefined;
  sessionOf(scope:Context):Session|undefined;
  subagentAddress(id:string):any;
  refresh():Promise<void>;
  refreshProjections(id:string):Promise<void>;
  search(query:string,signal:AbortSignal):Promise<any>;
  create(options?:any):Promise<string>;
  fork(options:any):Promise<string>;
  handleConnected():void;
  handleControlFrame(frame:any):void;
  handleSessionAdded(summary:any):void;
  handleSessionRemoved(id:string):void;
  handleSessionStatus(id:string,running:boolean):void;
  handleSessionActivity(id:string,time:number):void;
  handleSessionError(id:string,message:string):void;
}
export function createSessionControlStream(remote:any,options:any):{start():void;restart():void;dispose():Promise<void>};
