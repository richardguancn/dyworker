export class SessionHistoryController {
  constructor(ctx: any, promote: (observation: any) => void);
  page(request: any, signal: AbortSignal): Promise<any>;
  follow(request: any, signal: AbortSignal): AsyncIterable<any>;
}
export class SessionControlController {
  constructor(ctx:any);
  control(signal:AbortSignal):AsyncIterable<any>;
}
export class ApiSessionList {
  constructor(ctx:any,workSliceMs:number);
  list(signal?:AbortSignal):Promise<any[]>;
  search(query:string,signal:AbortSignal):Promise<{items:{sessionId:string;snippet:string}[];hasMore:boolean}>;
  summaryFor(session:any):any;
}
export const subagentCatalogProjectionDefinition: any;
export const subagentIdentityProjectionDefinition:any;
export function foldSubagentDescriptor(events:readonly any[]):any;
export function latestCompletedPrefixBoundary(events:readonly any[]):number|undefined;
