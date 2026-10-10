// Copyright 2026 DYWorker contributors. MIT License.
export function register(on,options){
  const folder=String(options.folder||'原始资料').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  if(!folder||folder.includes('..'))throw new Error('请选择有效的原始资料目录');
  const protectedPath=value=>{const parts=String(value||'').replace(/\\/g,'/').split('/').filter(Boolean);const normalized=[];
    for(const part of parts){if(part==='.')continue;if(part==='..')normalized.pop();else normalized.push(part);}return ('/'+normalized.join('/')+'/').includes('/'+folder+'/');};
  on('tool.call',async($,e,next)=>{
    const modifiesSource=['Write','Edit','Delete','Append','Move'].includes(e.tool)&&protectedPath(e.file_path||e.source);
    const overwritesTarget=['Move','Copy'].includes(e.tool)&&protectedPath(e.destination||e.target);
    if(modifiesSource||overwritesTarget){
      await $.ui.status('已保护原始资料，请另存副本后修改。');return {deny:'此文件位于原始资料目录，请读取资料并另存副本，不直接修改或删除原件。'};
    }return next(e);
  });
}
