import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const MOD_CATALOG=[
 {id:'token-weather',name:'上下文余量',version:'0.1.0',category:'效率工具',summary:'查看当前任务的上下文占用和最近变化。',license:'Apache-2.0',author:'Anthropic',source:'https://github.com/anthropics/claude-code-playground/tree/569c5283d9a0a7ee7938df85bb32e4f48cbb8c86/claude-code/mods/token-weather',revision:'569c5283d9a0a7ee7938df85bb32e4f48cbb8c86',scope:'显示本应用提供的上下文读数；估算值有明确标记。'},
 {id:'office-activity',name:'任务活动',version:'1.0.0',category:'办公',summary:'记录本次任务的操作数量，并在面板中查看。',license:'MIT',author:'DYWorker',source:'https://github.com/richardguancn/dyworker',revision:'bundled-1.0.0',scope:'操作计数、任务完成记录、会话隔离和清空计数。'},
 {id:'protect-originals',name:'保护原始文件',version:'1.0.0',category:'办公',summary:'阻止直接修改标记为原始资料的文件，提醒另存副本。',license:'MIT',author:'DYWorker',source:'https://github.com/richardguancn/dyworker',revision:'bundled-1.0.0',scope:'直接写入、编辑和删除指定资料目录中的文件；不覆盖命令行或外部程序。'},
];
export function bundledModsRoot(){let root=fileURLToPath(new URL('../../../',import.meta.url));if(path.basename(root)==='dist')root=path.dirname(root);
 return path.join(root,'builtin-plugins','claude-mods');}
