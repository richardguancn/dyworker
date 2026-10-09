import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHost,disposeHost} from '../electron/host/context.mts';

async function setup(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-plugin-detail-'));
  const host=await createHost({userDataDir:root,mountPlugins:true});
  t.after(async()=>{await disposeHost(host);await fs.rm(root,{recursive:true,force:true});});
  const dir=path.join(host.plugins.dir,'node_modules','detail-fixture');await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:'detail-fixture',version:'1.2.3',type:'module',main:'index.mjs',
    description:'实际包内说明',author:{name:'验收作者'},license:'MIT',homepage:'https://example.com/plugin',repository:{url:'git+https://example.com/source.git'},
    engines:{node:'>=22'},dependencies:{example:'1.0.0'}}));
  await fs.writeFile(path.join(dir,'index.mjs'),'export const name="detail-fixture"; export function apply() { globalThis.__detailApplied=(globalThis.__detailApplied||0)+1; }');
  await fs.writeFile(path.join(dir,'README.md'),'# 插件说明\n\n实际包内内容');
  assert.equal((await host.plugins.add({id:'detail',name:'detail-fixture'})).ok,true);
  return {root,host,dir};
}
test('插件详情读取实际元信息和说明，不重新执行插件；停用状态与卸载保持一致',async t=>{
  const {host}=await setup(t);const applied=globalThis.__detailApplied;
  const detail=await host.plugins.detail('detail');
  assert.equal(detail.metadata.version,'1.2.3');assert.equal(detail.metadata.author,'验收作者');assert.equal(detail.metadata.license,'MIT');
  assert.deepEqual(detail.metadata.dependencies,[{name:'example',version:'1.0.0'}]);assert.match(detail.readme,/实际包内内容/);
  assert.equal(detail.entry.active,true);assert.equal(detail.metadataError,null);assert.equal(globalThis.__detailApplied,applied);
  await host.plugins.setEnabled('detail',false);assert.equal((await host.plugins.detail('detail')).entry.disabled,true);
  await host.plugins.uninstall({spec:'detail'});await assert.rejects(host.plugins.detail('detail'),/不存在或已卸载/);
});
test('插件说明限长，不读取指向包外的说明文件；缺失资料明确返回原因',async t=>{
  const {root,host,dir}=await setup(t);
  await fs.writeFile(path.join(dir,'README.md'),'x'.repeat(70000));let detail=await host.plugins.detail('detail');
  assert.equal(detail.readme.length,65536);assert.equal(detail.readmeTruncated,true);
  await fs.unlink(path.join(dir,'README.md'));await fs.writeFile(path.join(root,'private.txt'),'不应出现在插件详情中的私有资料');
  await fs.symlink(path.join(root,'private.txt'),path.join(dir,'README.md'));
  detail=await host.plugins.detail('detail');assert.equal(detail.readme,'');assert.match(detail.metadataError,/包目录之外/);
  assert.doesNotMatch(JSON.stringify(detail),/不应出现在插件详情中的私有资料/);
  await fs.unlink(path.join(dir,'package.json'));detail=await host.plugins.detail('detail');assert.equal(detail.metadata,null);assert.ok(detail.metadataError);
});
