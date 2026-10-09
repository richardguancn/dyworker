import {Service} from '@deepseek-ai/cordis';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import semver from 'semver';
import {PLUGIN_CATALOG,isListedCatalogPackage,type CatalogPlugin} from '../verified-plugin-catalog.ts';
import {normalizeTelemetryServiceUrl} from '../../settings.mts';

export const PLUGIN_CATALOG_PATH='/api/v1/dyworker/plugins/catalog';
const MAX_BYTES=512*1024,REFRESH_MS=24*60*60*1000;
export function validatePluginCatalog(value:any,{hostVersion='0.2.2',platform=process.platform,arch=process.arch}:any={}){
 if(value?.code!==undefined){if(value.code!==200)throw new Error('平台未返回有效插件清单');value=value.data;}
 if(value?.schemaVersion!==1||typeof value.revision!=='string'||!value.revision.trim()||value.revision.length>80
  ||!Number.isFinite(Date.parse(value.publishedAt))||!Array.isArray(value.plugins)||value.plugins.length>1000)throw new Error('平台插件清单格式不正确');
 const plugins:CatalogPlugin[]=[],seen=new Set<string>();
 for(const row of value.plugins){
  if(row?.verified!==true||row?.status!=='published')continue;
  const support=row.support;
  const text=(v:any,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
  if(!text(row.id,200)||seen.has(row.id)||!/^[-\w.]+\/[-\w.]+$/.test(row.repo)
   ||!/^(@[-\w.]+\/)?[-\w.]+$/.test(row.packageName)||!text(row.displayName,100)||!text(row.summary,2000)||!text(row.category,40)
   ||!Array.isArray(row.tags)||row.tags.length>20||!row.tags.every((tag:any)=>text(tag,80))
   ||!support||!text(support.version,100)||!text(support.hostVersion,100)||semver.valid(support.version)!==support.version||semver.valid(support.hostVersion)!==support.hostVersion||!text(support.scope,2000)
   ||!/^\d{4}-\d{2}-\d{2}$/.test(support.date)||!Number.isFinite(Date.parse(support.date))||new Date(support.date).toISOString().slice(0,10)!==support.date
   ||!Array.isArray(support.platforms)||!support.platforms.length||!support.platforms.every((v:any)=>['darwin','win32','linux'].includes(v))
   ||!Array.isArray(support.architectures)||!support.architectures.length||!support.architectures.every((v:any)=>['arm64','x64','ia32'].includes(v))
   ||row.install!==`${row.packageName}@${support.version}`)throw new Error('平台已验证插件记录不完整或安装版本不明确');
  seen.add(row.id);
  if(!isListedCatalogPackage(row.packageName))continue;
  if(support.hostVersion!==hostVersion||!support.platforms.includes(platform)||!support.architectures.includes(arch))continue;
  plugins.push({id:row.id,repo:row.repo,packageName:row.packageName,displayName:row.displayName,stars:0,
   summary:row.summary,category:row.category,tags:[...row.tags],install:row.install,
   support:{version:support.version,hostVersion:support.hostVersion,scope:support.scope,date:support.date,
    platforms:[...support.platforms],architectures:[...support.architectures]}});
 }
 return {schemaVersion:1,revision:value.revision,publishedAt:value.publishedAt,plugins};
}
declare module '@deepseek-ai/cordis'{interface Context{pluginCatalog:PluginCatalogService;}}
export class PluginCatalogService extends Service{
 private lifetime=new AbortController();private writes=Promise.resolve();private requests=new Set<Promise<any>>();private generation=0;
 config:any;
 constructor(ctx:any,config:any){
  super(ctx,'pluginCatalog');this.config=config;
  ctx.effect(()=>async()=>{this.lifetime.abort(new Error('插件清单读取已关闭'));await Promise.allSettled([...this.requests]);await this.writes;});
 }
 read(force=false){const pending=this.load(force,++this.generation);this.requests.add(pending);void pending.finally(()=>this.requests.delete(pending)).catch(()=>{});return pending;}
 private async load(force:boolean,generation:number){
  const {config}=this,signal=this.lifetime.signal;signal.throwIfAborted();
  const source=normalizeTelemetryServiceUrl((await this.ctx.settings.read()).telemetry?.serviceUrl);
  const bundled=validatePluginCatalog({schemaVersion:1,revision:'bundled-2026-10-08',publishedAt:'2026-10-08T00:00:00Z',plugins:PLUGIN_CATALOG.map(row=>({...row,verified:true,status:'published'}))},config);
  const fallback=(notice='')=>({...bundled,source:'bundled',fetchedAt:null,notice});
  if(!source)return fallback('');
  const file=path.join(config.dir,'verified-plugin-catalog.json');
  const target=JSON.stringify([config.hostVersion||'0.2.2',config.platform||process.platform,config.arch||process.arch]);
  let cache:any;
  try{const stored=JSON.parse(await fs.readFile(file,'utf8'));if(stored.source===source&&stored.target===target&&Number.isFinite(stored.fetchedAt))cache={...validatePluginCatalog(stored.manifest,config),fetchedAt:stored.fetchedAt};}catch{/* 损坏、其他平台或其他应用版本的缓存不作为清单。 */}
  const now=(config.now||Date.now)();
  if(!force&&cache&&now>=cache.fetchedAt&&now-cache.fetchedAt<REFRESH_MS)return {...cache,source:'cache',notice:''};
  try{
   const response=await (config.fetch||fetch)(`${source}${PLUGIN_CATALOG_PATH}`,{method:'GET',headers:{accept:'application/json'},credentials:'omit',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
   if(!response.ok)throw new Error(`平台返回 ${response.status}`);
   if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('平台插件清单过大');
   const reader=response.body?.getReader();if(!reader)throw new Error('平台插件清单为空');
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)throw new Error('平台插件清单过大');chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   signal.throwIfAborted();const manifest=validatePluginCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')),config);
   if(normalizeTelemetryServiceUrl((await this.ctx.settings.read()).telemetry?.serviceUrl)!==source)throw new Error('平台地址已更换，请刷新插件清单');
   const fetchedAt=(config.now||Date.now)();
   const storedManifest={...manifest,plugins:manifest.plugins.map(row=>({...row,verified:true,status:'published'}))};
   const write=this.writes.then(async()=>{
    signal.throwIfAborted();
    if(generation!==this.generation)return;
    if(normalizeTelemetryServiceUrl((await this.ctx.settings.read()).telemetry?.serviceUrl)!==source)throw new Error('平台地址已更换，请刷新插件清单');
    await fs.mkdir(config.dir,{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
    try{await fs.writeFile(temporary,JSON.stringify({source,target,fetchedAt,manifest:storedManifest}));signal.throwIfAborted();if(generation===this.generation)await fs.rename(temporary,file);}
    finally{await fs.rm(temporary,{force:true});}
   });
   this.writes=write.catch(()=>{});await write;
   return {...manifest,source:'platform',fetchedAt,notice:''};
  }catch(error:any){
   signal.throwIfAborted();
   if(normalizeTelemetryServiceUrl((await this.ctx.settings.read()).telemetry?.serviceUrl)!==source)throw new Error('平台地址已更换，请刷新插件清单');
   const notice=`暂时无法更新，使用${cache?'上次保存':'随应用提供'}的已验证清单`;
   return cache?{...cache,source:'cache',notice}:fallback(notice);
  }
 }
}
