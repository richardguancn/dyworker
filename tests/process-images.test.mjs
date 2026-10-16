import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgent, toolDefinitions, externalPathsForTool, Workspace } from '../electron/agent.mts';
import { processImageAttachments } from '../src/processImages.ts';

test('图片记录仅解析明确成功的本地图片，存档后仍保留顺序', () => {
  const activity = { status: 'success', detail: JSON.stringify({ images: [{path:'/tmp/中文 空格.png'}, {path:'C:\\images\\a.jpg'}, {path:'https://example.test/a.png'}, {path:'/tmp/a.txt'}, null] }) };
  assert.deepEqual(processImageAttachments(JSON.parse(JSON.stringify(activity))).map(i=>i.path), ['/tmp/中文 空格.png','C:\\images\\a.jpg']);
  for (const detail of ['查看 /tmp/a.png', '{}', '[]', '{invalid']) assert.deepEqual(processImageAttachments({status:'success',detail}), []);
  assert.deepEqual(processImageAttachments({...activity,status:'error'}), []);
  assert.deepEqual(processImageAttachments({...activity,status:'running'}), []);
});

test('查看图片工具实际读取图片供模型理解，保留可展开记录，并报告不存在的图片', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'dyw-view-image-'));
  const bytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  try {
    await fs.writeFile(path.join(root,'示例.png'),Buffer.from(bytes,'base64'));
    assert.ok(toolDefinitions().some(t=>t.function.name==='view_image'));
    assert.deepEqual(externalPathsForTool(new Workspace(root), 'view_image', {path:'/outside/image.png'}), ['/outside/image.png']);
    for (const file of ['示例.png','missing.png']) {
      const events=[];let round=0;let received;
      await runAgent({ workspacePath:root, settings:{endpoint:'http://mock.local/v1/chat/completions',model:'mock',apiKey:'test'},
        conversation:[{role:'user',content:'查看图片'}], emit:e=>events.push(e), fetchImpl:async (_url,options)=>{
          const request=JSON.parse(options.body);
          if(round++===0)return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'img',type:'function',function:{name:'view_image',arguments:JSON.stringify({path:file})}}]}}]})};
          received=request.messages;
          return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'图片检查结束。'}}]})};
        }});
      const start=events.find(e=>e.type==='activity'&&e.activity.kind==='view_image');
      assert.ok(start);
      const done=events.find(e=>e.type==='activity-update'&&e.id===start.activity.id);
      assert.equal(done.status,file==='missing.png'?'error':'success');
      const images=received.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(p=>p.type==='image_url');
      if(file==='missing.png')assert.equal(images.length,0);
      else {assert.equal(images.at(-1).image_url.url,`data:image/png;base64,${bytes}`);assert.equal(processImageAttachments(done)[0].path,await fs.realpath(path.join(root,file)));}
    }
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('DSH 无扩展名的图片记录能按实际格式读取，伪造对象不会显示成图片', async () => {
  const { readLocalImageData } = await import('../electron/local-image.mts');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'dyw-image-object-'));
  const file = path.join(root,'objects','ab','ab'.repeat(32));
  try {
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
    const result=await readLocalImageData(file);
    assert.equal(result.ok,true);assert.match(result.dataUrl,/^data:image\/png;base64,/);
    assert.equal(processImageAttachments({status:'success',detail:JSON.stringify({images:[{path:file}]})}).length,1);
    await fs.writeFile(file,'not an image');
    assert.equal((await readLocalImageData(file)).ok,false);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
