import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activePermissions } from '../electron/active-permissions.mts';
import { evaluateApproval, runAgent } from '../electron/agent.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { createBotApproval } from '../electron/host/dsh-runtime/bot-harness.mts';
import { createHost, disposeHost } from '../electron/host/context.mts';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-active-permissions-'));
  const host = await createHost({ userDataDir: dir });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, {recursive:true, force:true}); });
  return {dir, host};
}

for (const [label, create] of [['DSH', createDshApproval], ['机器人', createBotApproval], ['桌面', null]]) {
  test(label + '等待人工时切到替我审批：撤回旧卡，当前操作按最新用户要求处理', async t => {
    const { host, dir } = await fixture(t);
    await host.settings.write({ approvalMode: 'interactive' });
    const conversation = [{ role: 'user', content: '核对样稿。' }];
    const controller = new AbortController();
    const settings = { endpoint: 'http://mock.local/v1/chat/completions', model: 'mock', apiKey: 'test' };
    const name = 'mcp__fixture__check_draft';
    const definition = { name, description: '只读核对演示稿', parameters: { type: 'object', properties: {} } };
    let cards = 0, withdrawn = 0, reviews = 0, checks = 0;
    const permissions = activePermissions('interactive', fn => host.settings.onApprovalModeChange(fn), async (_, signal) => {
      cards++;
      if (cards !== 1) return false;
      conversation.push({ role: 'user', content: '继续，核对完成后告诉我结果。' });
      let finish;
      const pending = new Promise(resolve => { finish = resolve; });
      signal.addEventListener('abort', () => { withdrawn++; finish(false); }, { once: true });
      await host.settings.write({ approvalMode: 'reviewer' });
      // 宿主写入设置并派发变更后，旧版仍会卡在这里。
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(signal.aborted, true, '模式切换后应撤回旧卡');
      return pending;
    }, controller.signal);
    t.after(permissions.dispose);
    function review(context) {
      reviews++;
      assert.match(context, /核对完成后告诉我结果/);
      return { decision: 'allow', reason: '核对样稿已授权' };
    }
    const common = { settings, approvalMode: 'interactive', getApprovalMode: permissions.getMode,
      requestApproval: permissions.request, workspacePath: dir, conversation };
    if (create) {
      const approve = create({ ...common, extraTools: [definition], extraToolNames: [name], extraToolDefinitions: [definition],
        review: async input => review(input.context) });
      if (await approve({ name, args: {}, signal: controller.signal })) checks++;
    } else {
      let turn = 0;
      const result = await runAgent({ ...common, extraTools: [{ type: 'function', function: definition }],
        onExtraTool: async () => { checks++; return { ok: true, result: '样稿一致' }; },
        fetchImpl: async (_url, options) => {
          const { messages } = JSON.parse(options.body);
          const message = messages[0].content.includes('安全审核助手')
            ? { role: 'assistant', content: JSON.stringify(review(messages.at(-1).content)) }
            : turn++ ? { role: 'assistant', content: '完成核对。' } : { role: 'assistant', tool_calls: [
              { id: 'check', type: 'function', function: { name, arguments: '{}' } }] };
          return { ok: true, json: async () => ({ choices: [{ message }] }) };
        } });
      assert.equal(result.status, 'done');
    }
    assert.deepEqual({ cards, withdrawn, reviews, checks }, { cards: 1, withdrawn: 1, reviews: 1, checks: 1 });
  });
}

test('同一任务三步排队：审核接手当前步骤，用户保留的决定只问一次，随后继续', async t => {
  const { host } = await fixture(t);
  await host.settings.write({ approvalMode: 'interactive' });
  const controller = new AbortController();
  const cards = [], reviewed = [];
  const live = activePermissions('interactive', listener => host.settings.onApprovalModeChange(listener), async card => {
    cards.push(card.id);
    if (card.id === 'second') return false;
    assert.equal(card.id, 'first');
    await host.settings.write({ approvalMode: 'reviewer' });
    return false;
  }, controller.signal);
  t.after(live.dispose);
  const approve = createDshApproval({ getApprovalMode: live.getMode, requestApproval: live.request,
    review: async ({ action }) => {
      reviewed.push(action.args.path);
      return action.args.path === 'b.txt' ? { decision: 'ask', reason: '用户要求亲自确认乙稿。' }
        : { decision: 'allow', reason: '授权范围内。' };
    } });
  // 使用需要逐次确认的扩展工具，三个请求共用同一条审批队列。
  const requests = [['first', 'a.txt'], ['second', 'b.txt'], ['third', 'c.txt']].map(([callId, path]) =>
    approve({ name: 'draft_check', args: { path }, callId, signal: controller.signal }));
  assert.deepEqual(await Promise.all(requests), [true, false, true]);
  assert.deepEqual(reviewed, ['a.txt', 'b.txt', 'c.txt']);
  assert.deepEqual(cards, ['first', 'second']);
});

test('撤卡尚未结束又切回逐次确认，按最后选的模式继续等待', async t => {
  const controller = new AbortController();
  let changeMode, finish, visible = 0;
  const shown = Promise.withResolvers();
  const live = activePermissions('interactive', listener => { changeMode = listener; }, (_card, signal) => {
    visible++;
    if (visible === 2) {
      shown.resolve();
      return new Promise(resolve => { finish = resolve; });
    }
    return new Promise(resolve => signal.addEventListener('abort', () => {
      changeMode('interactive');
      resolve(false);
    }, { once: true }));
  }, controller.signal);
  t.after(live.dispose);
  const outcome = live.request({ kind: 'read_file' }, () => live.getMode() === 'reviewer' ? 'review' : 'ask');
  changeMode('reviewer');
  await shown.promise;
  finish(false);
  assert.equal(await outcome, false);
  assert.equal(visible, 2);
});

test('切换完全访问撤回当前等待；强制确认与只读任务仍生效', async t => {
  for (const scenario of [{mode:'interactive'}, {mode:'interactive', hook:true}, {mode:'deny-changes'}]) {
    await t.test(JSON.stringify(scenario), async t => {
      const {host} = await fixture(t);
      await host.settings.write({approvalMode:'interactive'});
      let pendingSignal, finish;
      const controller = new AbortController();
      const live = activePermissions(scenario.mode, fn=>host.settings.onApprovalModeChange(fn),
        (_, signal) => { pendingSignal=signal; return new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',()=>resolve(false),{once:true});}); }, controller.signal);
      t.after(live.dispose);
      const pending = live.request({kind:'run_command'}, () => evaluateApproval({approvalMode:live.getMode(), name:'run_command',
        args:{command:'python3 report.py'}, hookRequiresApproval:scenario.hook}));
      await host.settings.write({approvalMode:'full-access'});
      if (scenario.hook) { assert.equal(pendingSignal.aborted,false); finish(false); }
      assert.equal(await pending, scenario.mode === 'deny-changes' || scenario.hook ? false : null);
      if (pendingSignal) assert.equal(pendingSignal.aborted,true);
      assert.equal(live.getMode(), scenario.mode === 'deny-changes' ? 'deny-changes' : 'full-access');
    });
  }
});

test('DSH 审批等待随设置更新，切回请示后重新确认；取消不悬挂', async t => {
  const {host} = await fixture(t);
  await host.settings.write({approvalMode:'interactive'});
  const controller=new AbortController(); let asks=0, entered;
  const gate=new Promise(r=>entered=r);
  const live=activePermissions('interactive',fn=>host.settings.onApprovalModeChange(fn),(_,signal)=>{
    asks++; entered(); return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(false),{once:true}));
  },controller.signal); t.after(live.dispose);
  const approve=createDshApproval({approvalMode:'interactive',getApprovalMode:live.getMode,requestApproval:live.request});
  const tool={name:'shell',args:{command:'python3 report.py'},signal:controller.signal};
  const first=approve(tool); await gate;
  await host.settings.write({approvalMode:'full-access'});
  assert.equal(await first,true); assert.equal(asks,1);
  assert.equal(await approve(tool),true); assert.equal(asks,1);
  await host.settings.write({approvalMode:'interactive'});
  const second=approve(tool);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(asks,2); controller.abort(new Error('测试停止'));
  await assert.rejects(second,/测试停止/);
});

test('实际创建并执行 Python：当前审批自动撤回，下一步免打扰，收紧权限后再次请示', async t => {
  const {host, dir}=await fixture(t);
  await host.settings.write({approvalMode:'interactive'});
  const controller=new AbortController(); let asks=0;
  const live=activePermissions('interactive',fn=>host.settings.onApprovalModeChange(fn),async(_,signal)=>{
    asks++;
    if(asks===1) {
      const pending=host.inbox.create({kind:'approval',title:'运行本地脚本'}, {signal});
      await host.settings.write({approvalMode:'full-access'});
      return (await pending).ok;
    }
    return false;
  },controller.signal); t.after(live.dispose);
  let step=0;
  const commands=[
    {name:'write_file',args:{path:'report.py',content:"from pathlib import Path\nPath('report.txt').write_text('verified', encoding='utf8')\nprint('verified')\n"}},
    {name:'run_command',args:{command:'python3 report.py'}},
    {name:'run_command',args:{command:'python3 report.py'}},
    {name:'run_command',args:{command:'python3 report.py'}},
  ];
  const toolResults=[];
  const result=await runAgent({settings:{endpoint:'http://mock.local/v1/chat/completions',model:'mock',apiKey:'test'},workspacePath:dir,
    approvalMode:'interactive',getApprovalMode:live.getMode,requestApproval:live.request,
    conversation:[{role:'user',content:'在当前目录生成报告并验证结果'}],fetchImpl:async(_,options)=>{
      const body=JSON.parse(options.body);
      let message;
      if(body.messages[0].content.includes('审批说明撰写助手')) message={role:'assistant',content:'运行本地脚本'};
      else {
        assert.match(body.messages[0].content,/默认保存在当前工作目录/);
        if(step===3) await host.settings.write({approvalMode:'interactive'});
        toolResults.splice(0,toolResults.length,...body.messages.filter(x=>x.role==='tool'));
        const call=commands[step++];
        message=call?{role:'assistant',content:null,tool_calls:[{id:`step-${step}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{role:'assistant',content:'检查结束'};
      }
      return {ok:true,json:async()=>({choices:[{message}]})};
    }});
  assert.equal(result.status,'done'); assert.equal(asks,2);
  assert.equal(await fs.readFile(path.join(dir,'report.txt'),'utf8'),'verified');
  assert.match(toolResults[1].content,/verified/); assert.match(toolResults[2].content,/verified/);
  assert.match(toolResults[3].content,/用户拒绝/);
  await host.inbox.persistQueue;
  assert.equal((await host.inbox.read()).filter(x=>x.status==='pending').length,0);
  assert.equal(host.inbox.pending.size,0);
});
