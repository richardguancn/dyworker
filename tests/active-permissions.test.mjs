import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activePermissions } from '../electron/active-permissions.mts';
import { evaluateApproval, runAgent } from '../electron/agent.mts';
import { createDshApproval } from '../electron/host/dsh-runtime/approval.mts';
import { createHost, disposeHost } from '../electron/host/context.mts';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-active-permissions-'));
  const host = await createHost({ userDataDir: dir });
  t.after(async () => { await disposeHost(host); await fs.rm(dir, {recursive:true, force:true}); });
  return {dir, host};
}

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
