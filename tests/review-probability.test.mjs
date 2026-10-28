import assert from 'node:assert/strict';
import test from 'node:test';
import { readBinaryProbability,canApproveFromProbability,formatProbability,requestProbabilityReview } from '../electron/agent/review-probability.mts';
import { loadReviewerPolicy,reviewApproval } from '../electron/agent/review.mts';
import { deserializeSettings,serializeSettings } from '../electron/settings.mts';

const logs = (yes=.995,no=.004,token='Y') => [{token,logprob:Math.log(token==='Y'?yes:no),
  top_logprobs:[{token:'Y',logprob:Math.log(yes)},{token:'N',logprob:Math.log(no)}]}];
const response = body => ({ok:true,json:async()=>body});
const binary = (yes=.995,no=.004,token='Y') => response({choices:[{finish_reason:'stop',
  message:{role:'assistant',content:token},logprobs:{content:logs(yes,no,token)}}]});
const detailed = (decision='deny',extra={}) => response({choices:[{message:{role:'assistant',
  content:JSON.stringify({decision,reason:'具体判断理由',...extra})}}]});
const settings = name => ({endpoint:`http://${name}.test/v1/chat/completions`,model:'fixture',reviewerProbability:true});

test('概率只来自真实候选，并保留二选一之外的概率质量',()=>{
  const p=readBinaryProbability('Y',logs());
  assert.equal(p.source,'model_logprobs'); assert.equal(p.calibrated,false);
  assert.ok(Math.abs(p.yes+p.no-1)<1e-12); assert.equal(p.labelMass,.999);
  assert.equal(canApproveFromProbability(p),true);
  assert.equal(canApproveFromProbability(readBinaryProbability('Y',logs(.0099,.00001))),false);
  assert.equal(canApproveFromProbability(readBinaryProbability('Y',logs(.7,.3))),false);
  assert.equal(canApproveFromProbability(readBinaryProbability('N',logs(.001,.998,'N'))),false);
});

test('极端概率不因四舍五入显示为确定事件',()=>{
  assert.equal(formatProbability(.9999999),'大于 99.99%');
  assert.equal(formatProbability(.0000001),'小于 0.01%');
  assert.equal(formatProbability(.995),'99.50%');
});

test('缺失候选、异常数值、重复字段候选、自报概率和未结束输出不能放行',()=>{
  const broken=[null,[],[{token:'Y',logprob:0,top_logprobs:[]}],
    [{token:'Y',logprob:0,top_logprobs:[{token:'Y',logprob:0}]}],
    [{token:'Y',logprob:'0',top_logprobs:logs()[0].top_logprobs}],
    logs(.9,.8), logs(NaN,.1), logs(1.1,.1),
    [{...logs()[0],top_logprobs:[...logs()[0].top_logprobs,...logs()[0].top_logprobs]}],
    [{...logs()[0],logprob:Math.log(.5)}]];
  for(const entry of broken) assert.equal(readBinaryProbability('Y',entry),null);
  for(const text of ['Y N','{"yes":0.99}','<think>Y','Yes','Y because…','']) assert.equal(readBinaryProbability(text,logs()),null);
});

test('实际审核路径：明确的常规操作只请求一次、不生成理由',async()=>{
  let count=0;
  const result=await reviewApproval({settings:settings('fast'),context:'创建报告',action:{kind:'write_file',details:'report.txt'},
    fetchImpl:async(_,options)=>{ count++;const body=JSON.parse(options.body);
      assert.equal(body.logprobs,true);assert.equal(body.top_logprobs,20);assert.equal(body.max_tokens,4);
      assert.equal(body.stream,false);assert.equal(body.tools,undefined);assert.match(body.messages[0].content,/只能|仅|只输出/);
      return binary(); }});
  assert.equal(count,1);assert.equal(result.decision,'allow');assert.equal(result.probability.source,'model_logprobs');
  assert.equal(result.execution,undefined);
});

test('否、概率不足都继续完整审核，保留拒绝、补查和人工决定',async()=>{
  for(const [i,yes,no,token,decision,extra,status] of [
    [1,.001,.998,'N','deny',{},'denied'],
    [2,.7,.3,'Y','ask',{needsEvidence:true},'needs_evidence'],
    [3,.4,.6,'N','ask',{},'needs_authorization'],
    [4,.001,.998,'N','allow',{execution:'host'},'allowed'],
  ]) {
    let count=0;
    const result=await reviewApproval({settings:settings(`fallback${i}`),action:{kind:'run_command',details:'example'},
      fetchImpl:async()=>++count===1?binary(yes,no,token):detailed(decision,extra)});
    assert.equal(count,2);assert.equal(result.status,status);assert.equal(result.execution,extra.execution);
    assert.match(result.reason,/快速判断/);assert.match(result.reason,/完整审核：具体判断理由/);
  }
});

test('服务不支持概率时回到原审核，短期内不重复探测',async()=>{
  let probabilityCalls=0;
  const fetchImpl=async(_,options)=>{
    if(JSON.parse(options.body).logprobs){probabilityCalls++;return response({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Y'}}]});}
    return detailed();
  };
  for(let i=0;i<2;i++) {
    const result=await reviewApproval({settings:settings('unsupported'),fetchImpl});
    assert.equal(result.decision,'deny');
  }
  assert.equal(probabilityCalls,1);
});

test('Responses 概率路径读取完整输出，不把截断或工具调用当作批准',async()=>{
  const body={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Y',logprobs:logs()}]}]};
  for(const [i,result,expected] of [[0,body,true],[1,{...body,status:'incomplete'},false],
    [2,{...body,output:[...body.output,{type:'function_call',name:'run_command'}]},false]]) {
    const p=await requestProbabilityReview({settings:{...settings(`responses${i}`),endpoint:`http://responses${i}.test/v1/responses`},policy:loadReviewerPolicy().text,reviewText:'完整材料',
      fetchImpl:async(_,options)=>{const request=JSON.parse(options.body);assert.deepEqual(request.include,['message.output_text.logprobs']);assert.equal(request.store,false);
        assert.doesNotMatch(request.input[0].content,/输出：仅一个 JSON 对象/);assert.match(request.input[0].content,/只输出一个大写 Y 或 N/);return response(result);}});
    assert.equal(canApproveFromProbability(p),expected);
  }
});

test('Chat 被截断或带工具调用不能快速批准',async()=>{
  for(const [i,change] of [[0,{finish_reason:'length'}],[1,{message:{role:'assistant',content:'Y',tool_calls:[{}]}}]]) {
    const body=await binary().json();Object.assign(body.choices[0],change);
    const p=await requestProbabilityReview({settings:settings(`invalid${i}`),policy:loadReviewerPolicy().text,reviewText:'材料',fetchImpl:async()=>response(body)});
    assert.equal(p,null);
  }
});

test('自定义审核输出规则不会被快速路径覆盖',async()=>{
  let calls=0;
  const p=await requestProbabilityReview({settings:settings('custompolicy'),policy:loadReviewerPolicy().text+'\n额外限制：必须返回理由。',reviewText:'材料',fetchImpl:async()=>{calls++;return binary();}});
  assert.equal(p,null);assert.equal(calls,0);
});

test('取消审核后迟到的高概率允许无效',async()=>{
  const controller=new AbortController();
  const result=await reviewApproval({settings:settings('cancel'),signal:controller.signal,fetchImpl:async()=>{
    controller.abort(new Error('已取消'));return binary();}});
  assert.equal(result.unavailable,true);assert.notEqual(result.decision,'allow');
});

test('内置小模型不被快速路径升级为独立审批',async()=>{
  let calls=0;
  const result=await reviewApproval({settings:{...settings('local'),reviewerBackend:'local'},
    localReviewImpl:async()=>'{"decision":"allow","reason":"本地批准"}',fetchImpl:async()=>{calls++;return binary();}});
  assert.equal(calls,0);assert.equal(result.unavailable,true);
});

test('概率模式随设置保存，默认开启但可明确关闭',()=>{
  const enabled=deserializeSettings({},null);assert.equal(enabled.reviewerProbability,true);
  const disabled=deserializeSettings({reviewerProbability:false},null);assert.equal(disabled.reviewerProbability,false);
  assert.equal(serializeSettings(disabled,null).reviewerProbability,false);
});
