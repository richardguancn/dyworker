import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bindSessionModel, modelSelection, settingsForSession } from '../electron/session-model.mts';
import { createSessionArchive } from '../electron/session-archive.mts';
import { runAgent } from '../electron/agent.mts';

const one = { id: 'one', endpoint: 'https://one.example/v1/chat/completions', model: 'model-one', apiKey: 'key-one', reasoningEffort: 'high' };
const two = { id: 'two', endpoint: 'https://two.example/v1/chat/completions', model: 'model-two', apiKey: 'key-two', reasoningEffort: '' };
const settings = { ...one, profiles: [one, two], approvalMode: 'interactive' };

test('两个会话各自保留模型和思考强度，重开后请求仍发往各自的服务', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-session-model-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const archive = createSessionArchive({dir:path.join(dir, 'sessions')});
  const sessions = [
    bindSessionModel({id:'a',messages:[]}, settings),
    {...bindSessionModel({id:'b',messages:[]}, settings), modelSelection:modelSelection({...settings,...two})},
  ];
  await archive.saveAll(sessions);
  const reopened = createSessionArchive({dir:path.join(dir, 'sessions')});
  const requests = [];
  for (const id of ['a','b','a']) {
    const session = await reopened.get(id);
    assert.equal(JSON.stringify(session).includes('key-'), false, '会话存档不得复制模型密钥');
    const bound = settingsForSession({...settings,...two}, session);
    const result = await runAgent({settings:bound,workspacePath:dir,conversation:[{role:'user',content:'回复已收到'}],
      approvalMode:'interactive',fetchImpl:async(url, options) => {
        const body = JSON.parse(options.body);
        requests.push({url,model:body.model,authorization:options.headers.Authorization});
        return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'已收到'}}]})};
      }});
    assert.equal(result.status,'done');
    assert.equal(bound.reasoningEffort,id==='b'?'':'high');
  }
  assert.deepEqual(requests.map(row=>[row.url,row.model]), [one,two,one].map(row=>[row.endpoint,row.model]));
  assert.deepEqual(requests.map(row=>row.authorization), ['Bearer key-one','Bearer key-two','Bearer key-one']);
});

test('旧会话按上次模型恢复，新会话采用默认选择，已有选择不被覆盖', () => {
  const old = bindSessionModel({contextModel:two.model,contextEndpoint:two.endpoint}, settings);
  assert.equal(old.modelSelection.profileId,two.id);
  assert.equal(bindSessionModel(old,settings),old);
  assert.equal(bindSessionModel({},settings).modelSelection.model,one.model);
  assert.equal(bindSessionModel({},{}).modelSelection,undefined);
  const missing = bindSessionModel({contextModel:'removed',contextEndpoint:'https://removed.example/v1'},settings);
  assert.equal(settingsForSession(settings,missing).model,'removed');
  assert.equal(settingsForSession(settings,missing).apiKey,'');
});

test('凭据更新即时采用；删除或改动配置后不会偷用其他模型', () => {
  const session = {modelSelection:modelSelection(settings)};
  assert.equal(settingsForSession({...settings,profiles:[{...one,apiKey:'renewed'},two]},session).apiKey,'renewed');
  const removed = settingsForSession({...settings,...two,profiles:[two]},session);
  assert.equal(removed.model,one.model);
  assert.equal(removed.endpoint,one.endpoint);
  assert.equal(removed.apiKey,'');
  const edited = settingsForSession({...settings,...two,profiles:[{...two,id:one.id}]},session);
  assert.equal(edited.apiKey,'');
  assert.equal(settingsForSession({...settings,profiles:[{...one,id:'imported'}]},session).apiKey,one.apiKey);
});
