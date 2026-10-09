/** 随应用提供的已验证清单；平台清单更新只改变展示，不自动更新插件。 */
export interface CatalogPlugin {
 id:string; repo:string; packageName:string; displayName:string; stars:number;
 summary:string; category:string; tags:string[]; install:string;
 support:{version:string;hostVersion:string;scope:string;date:string;platforms:string[];architectures:string[]};
}
export const CATALOG_SNAPSHOT_DATE='2026-10-08';
export const CATALOG_CATEGORIES=['办公','效率工具'] as const;
export const PLUGIN_CATALOG:CatalogPlugin[]=[
 {id:'kw78/dsh-office-tools',repo:'kw78/dsh-office-tools',packageName:'dsh-office-tools',displayName:'办公文档',stars:0,
 summary:'创建、读取和修改 Word、Excel 文件，创建和读取 PowerPoint 文件。',category:'办公',tags:['Word','Excel','PowerPoint','文档'],install:'dsh-office-tools@1.0.5',
 support:{version:'1.0.5',hostVersion:'0.2.2',scope:'Word、Excel 创建读取修改，PowerPoint 创建读取',date:'2026-10-08',platforms:['darwin'],architectures:['arm64']}},
 {id:'deepseek-ai/dsh-tool-todo',repo:'deepseek-ai/deepseek-harness',packageName:'@deepseek-ai/dsh-tool-todo',displayName:'待办清单',stars:0,
 summary:'管理任务的待办事项，保存进度，各个任务独立维护。',category:'效率工具',tags:['待办','清单','进度'],install:'@deepseek-ai/dsh-tool-todo@0.2.1-alpha.1',
 support:{version:'0.2.1-alpha.1',hostVersion:'0.2.2',scope:'待办更新、任务之间隔离、保存恢复、停用启用',date:'2026-10-08',platforms:['darwin'],architectures:['arm64']}},
];
/** 产品使用内置上下文面板；旧缓存和旧平台清单也不能恢复第三方上下文推荐。 */
export function isListedCatalogPackage(packageName:string){return packageName!=='dsh-context';}
export function catalogSorted(catalog:CatalogPlugin[]=PLUGIN_CATALOG){return [...catalog].sort((a,b)=>a.category.localeCompare(b.category,'zh-CN')||a.displayName.localeCompare(b.displayName,'zh-CN'));}
export function filterCatalog(keyword:string,category='',catalog:CatalogPlugin[]=PLUGIN_CATALOG){
 const needle=keyword.trim().toLowerCase();return catalogSorted(catalog).filter(plugin=>(!category||plugin.category===category)&&(!needle||[plugin.displayName,plugin.repo,plugin.packageName,plugin.summary,plugin.category,...plugin.tags].join(' ').toLowerCase().includes(needle)));
}
export function isInstalled(plugin:CatalogPlugin,entries:Array<{id:string;name:string}>){
 const wanted=new Set([plugin.packageName,plugin.repo,plugin.id].map(name=>name.toLowerCase()));
 return entries.some(entry=>wanted.has(String(entry.name||'').toLowerCase())||wanted.has(String(entry.id||'').toLowerCase()));
}
export function isVerifiedEntry(entry:{id:string;name:string;builtin?:boolean},version:string|undefined,catalog:CatalogPlugin[]=PLUGIN_CATALOG){
 return entry.builtin===true||catalog.some(plugin=>entry.name===plugin.packageName&&version===plugin.support.version);
}
