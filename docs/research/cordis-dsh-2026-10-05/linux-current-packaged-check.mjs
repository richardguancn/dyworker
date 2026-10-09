import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const root='/evidence/client-alias-package/linux-arm64-unpacked/resources/app.asar.unpacked';
const {installPackageIntoProfile}=await import(pathToFileURL(path.join(root,'dist/electron/host/plugin-install.mjs')));
const {OfficialDshSession}=await import(pathToFileURL(path.join(root,'dist/electron/host/dsh-runtime/full-session.mjs')));
const {PtcExecutor}=await import(pathToFileURL(path.join(root,'dist/electron/host/dsh-runtime/ptc-executor.mjs')));
const dir=await fs.mkdtemp('/work/dyw-final-package-');const profileDir=path.join(dir,'plugins');const workspacePath=path.join(dir,'work');
await fs.mkdir(profileDir);await fs.mkdir(workspacePath);await fs.writeFile(path.join(profileDir,'package.json'),'{"name":"isolated-packaged-acceptance","private":true}');
const previousPath=process.env.PATH;process.env.PATH='';
const installed=await installPackageIntoProfile({dir:profileDir,input:'dsh-office-tools@1.0.5',legacyPeerDeps:true});
assert.equal(installed.ok,true,installed.error);assert.ok(installed.command.startsWith(root),installed.command);
process.env.PATH=previousPath;
await fs.mkdir(path.join(profileDir,'node_modules/@deepseek-ai'),{recursive:true});
for(const name of await fs.readdir(path.join(root,'node_modules/@deepseek-ai'))){const target=path.join(profileDir,'node_modules/@deepseek-ai',name);await fs.rm(target,{recursive:true,force:true});await fs.symlink(path.join(root,'node_modules/@deepseek-ai',name),target,'dir');}
const sessionId='packaged-final';let rootCalls=0;const children=new Set();
const runtime=new OfficialDshSession({profileDir,workspacePath,dataDir:path.join(dir,'dsh-data'),sessionId,
  plugins:[{id:'office',entryUrl:pathToFileURL(path.join(profileDir,'node_modules/dsh-office-tools/lib/index.js')).href}],approve:async()=>true,
  async *generate(request){let block;if(request.sessionId!==sessionId){children.add(request.sessionId);block={type:'text',text:'包内子任务完成'};}else {const call=rootCalls++;block=call===0?{type:'tool-call',id:'actual-doc',name:'word_create',arguments:JSON.stringify({path:'actual.docx',paragraphs:['Linux 最新打包应用实际生成']})}:call===1?{type:'tool-call',id:'actual-workflow',name:'workflow',arguments:JSON.stringify({meta:{name:'packaged-workflow',description:'包内执行器验收'},script:"const results=await parallel([()=>agent('核对甲'),()=>agent('核对乙')]);return {results};"})}:{type:'text',text:'文件和工作流完成'};}
    yield {type:'block-start',index:0,blockType:block.type};yield block.type==='tool-call'?{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}:{type:'text-delta',index:0,text:block.text};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
  }});
const executor=new PtcExecutor(workspacePath);
const imageBytes=await fs.readFile('/evidence/attachment-fixture.png');
let verifiedImage;
try{await runtime.start();const image=await runtime.persistenceContext.attachments.saveImage({data:imageBytes,mediaType:'image/png',name:'包内图片.png'});const read=await runtime.persistenceContext.attachments.readImage(image);assert.ok(read.data.length);assert.equal(image.width,1);assert.equal(image.height,1);verifiedImage={width:image.width,height:image.height,bytes:read.data.length};const result=await runtime.request('prompt',{text:'检查包内办公和工作流'});const file=await fs.readFile(path.join(workspacePath,'actual.docx'));assert.equal(file.subarray(0,2).toString(),'PK');assert.equal(children.size,2);const toolResults=result.events.filter(event=>event.type==='tool/result');assert.ok(toolResults.length>=2);assert.ok(toolResults.every(event=>!event.data.message.isError));
const program=await executor.run({program:'return (await import("node:fs/promises")).readFile("actual.docx").then(bytes=>bytes.subarray(0,2).toString());',cwd:workspacePath,sandboxPolicy:{mode:'workspace-write',workspaceRoot:workspacePath},bindings:[]},async()=>null,new AbortController().signal);assert.equal(program.error,undefined,JSON.stringify(program));assert.equal(program.value,'PK');
console.log(JSON.stringify({ok:true,platform:process.platform,arch:process.arch,electronNode:process.versions.node,executable:process.execPath,root,npm:installed.command,plugin:'dsh-office-tools@1.0.5',fileBytes:file.length,eventCount:result.events.length,workflowChildren:children.size,ptcReadBack:program.value,usesSystemNode:false,officialImageReadBack:verifiedImage,systemSandboxDependency:'bubblewrap',userData:'new isolated temporary directory'}));
}finally{await executor.close();await runtime.close();}
