import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, MemoryRepositories, ticketStage } from './src/core/index.js';
import { Store } from './src/app/store.js';
import { Effects } from './src/app/effects.js';
import { HealthBoard } from './src/infra/health.js';
import { Outbox } from './src/app/outbox.js';

function harness(repo = new MemoryRepositories()) {
  const requests = [], launches = [], deliveries = [], replies = [];
  let version = 'v1', seconds = 0;
  const policy = { get version() { return version; }, paused: false, evalTimeoutMs: 60000,
    gate: t => t.human ? { admissible: true, strength: 'explicit', basis: { via: 'listed' } } : { admissible: false, reason: 'bot' },
    revalidate: () => version !== 'revoked', admitsInferred: rules => rules.length > 0 };
  const engine = new Engine({repo, policy: () => policy,
    scope: {scope: () => ({listened: true, observed: false})},
    assessor: {request: c => requests.push(c), release: () => {}},
    executor: {start: (ticket, assignment) => launches.push([ticket, assignment]), deliver: t => deliveries.push(t.id), stop: () => {}},
    outbox: {send: m => replies.push(m), status: id => replies.some(m => m.id === id) ? 'pending' : undefined, withdraw: () => {}},
    now: () => new Date(Date.UTC(2026, 9, 31, 0, 0, seconds)).toISOString()});
  const trigger = (id, thread = 't1', human = true) => ({id, source: 'chat', threads: [{source: 'chat', id: thread}], actor: {source: 'chat', id: 'alice'}, human,
    at: new Date(Date.UTC(2026,9,31,0,0,++seconds)).toISOString(), text: `message ${id}`, channel: {source: 'chat', thread, address: {message: id}}, meta: {}});
  const accept = (id = '1', thread = 't1') => {
    engine.receive(trigger(id, thread)); engine.evaluateDue();
    const candidate = requests.at(-1);
    const decision = engine.decide(id, {kind: 'accept', evalId: candidate.evalId, title: 'Research', scope: 'one document', reason: 'requested', acknowledgement: 'ok'});
    const [ticket, assignment] = launches.at(-1);
    engine.assignmentStarted(ticket.id, assignment.id);
    engine.inputsDelivered(ticket.id, assignment.id, repo.tickets.get(ticket.id).undelivered);
    return decision.ticketId;
  };
  return {repo, engine, requests, launches, deliveries, trigger, accept, setVersion: v => {version=v;}, tick: () => {seconds++;}};
}

test('同一事件重复到达只保存一次', () => {
  const h=harness(), t=h.trigger('1');
  assert.equal(h.engine.receive(t),'stored'); assert.equal(h.engine.receive(t),'duplicate');
  h.engine.evaluateDue(); assert.equal(h.requests.length,1);
});
test('后续消息进入原任务，独立话题仍可评估新任务', () => {
  const h=harness(), id=h.accept();
  h.engine.receive(h.trigger('2')); h.engine.evaluateDue();
  assert.equal(h.requests.length,1);
  assert.ok(h.repo.tickets.get(id).inputs.some(i => i.triggerId==='2'));
  h.engine.receive(h.trigger('3','other')); h.engine.evaluateDue();
  assert.equal(h.requests.length,2);
});
test('人工停止后，后续消息不会自动复活旧任务', () => {
  const h=harness(), id=h.accept(); h.engine.stopTicket(id);
  h.engine.receive(h.trigger('2')); h.engine.evaluateDue();
  assert.ok(h.repo.tickets.get(id).ended); assert.equal(h.requests.length,2);
  assert.equal(h.launches.length,1);
});
test('规则已变化时，旧评估不能直接创建任务', () => {
  const h=harness(); h.engine.receive(h.trigger('1'));h.engine.evaluateDue();
  const candidate=h.requests[0]; h.setVersion('v2');
  const result=h.engine.decide('1',{kind:'accept',evalId:candidate.evalId,title:'Research',scope:'one document',reason:'requested',acknowledgement:'ok'});
  assert.equal(result.kind,'unavailable');assert.equal(h.launches.length,0);
});
test('受阻与普通等待明确分开，人工补充后可以继续', () => {
  const h=harness(), id=h.accept();h.tick();h.engine.report(id,{state:'blocked',summary:'missing input'});
  assert.deepEqual(ticketStage(h.repo.tickets.get(id)),{stage:'person',action:'blocked'});
  h.engine.receive(h.trigger('2','t1',false));
  assert.deepEqual(ticketStage(h.repo.tickets.get(id)),{stage:'person',action:'blocked'});
  h.engine.receive(h.trigger('3'));
  assert.equal(ticketStage(h.repo.tickets.get(id)).stage,'working');
});
test('关闭并重开真实存储后仍能识别重复事件', () => {
  const dir=mkdtempSync(join(tmpdir(),'dsh-research-'));let store;
  try {const file=join(dir,'state.sqlite');store=new Store(file);const h=harness(store),t=h.trigger('1');
    assert.equal(h.engine.receive(t),'stored');store.close();store=new Store(file);
    assert.equal(harness(store).engine.receive(t),'duplicate');
  } finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('未提交动作不会执行，已保存动作在重启后继续', async () => {
  const dir=mkdtempSync(join(tmpdir(),'dsh-effects-'));let store, effects;
  try {const file=join(dir,'state.sqlite');store=new Store(file);effects=new Effects(store,new HealthBoard());
    store.atomic(()=>effects.enqueue('relay','kept',{text:'keep'}));
    assert.throws(()=>store.atomic(()=>{effects.enqueue('relay','rollback',{text:'drop'});throw Error('rollback');}));
    await effects.drain();store.close();store=new Store(file);effects=new Effects(store,new HealthBoard());const sent=[];
    effects.handle('relay',async(payload,key)=>sent.push(key));effects.start();await effects.idle();
    assert.deepEqual(sent,['kept']);assert.equal(effects.pending('relay'),false);
  } finally {await effects?.drain();store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('外发失败会等待后重试，同一消息编号不会再次发送', async () => {
  const dir=mkdtempSync(join(tmpdir(),'dsh-outbox-'));let store,effects;
  try {store=new Store(join(dir,'state.sqlite'));let now=Date.now(), attempts=0;
    effects=new Effects(store,new HealthBoard(),()=>now);
    const outbox=new Outbox({store,effects,commands:{},paused:()=>false,sources:{instance:()=>({enabled:true}),channelAllowed:()=>true,
      send:async()=>{if(++attempts===1)throw Error('offline');return 'sent';}}});
    const message={id:'message-1',channel:{source:'chat',thread:'t1',address:{}},text:'done',kind:'notice'};
    outbox.send(message);effects.start();await effects.idle();assert.equal(outbox.status(message.id),'pending');assert.equal(attempts,1);
    now+=5000;await effects.idle();assert.equal(outbox.status(message.id),'sent');assert.equal(attempts,2);
    outbox.send(message);await effects.idle();assert.equal(attempts,2);
  } finally {await effects?.drain();store?.close();rmSync(dir,{recursive:true,force:true});}
});
