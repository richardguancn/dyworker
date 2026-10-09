export interface ConnectionRecoveryConfig {
  backoffBaseMs?:number;backoffFactor?:number;backoffMaxMs?:number;
  generationReadyWarnMs?:number;generationReadyTimeoutMs?:number;
}
export class ConnectionController {
  constructor(source:(signal:AbortSignal,ready:(host:{home:string})=>void)=>Promise<void>,sinks?:{
    onConnected?:(host:{home:string})=>void;
    onStateChange?:(state:'connected'|'disconnected'|'connecting')=>void;
    onReconnectRequested?:()=>void;
  },config?:ConnectionRecoveryConfig);
  start():void;stop():void;reconnect():void;setNetworkAvailable(available:boolean):void;
}
