import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {ConnectionService} from '../electron/host/services/connection.mts';
import {pluginApiIpcPlugin} from '../electron/host/plugins/plugin-api-ipc.mts';

test('DSH 会话读取原生插件接口仍交给原生插件；官方接口才进入所属 DSH 会话', async()=>{
  const ctx=new Context();const handlers=new Map();let officialCalls=0;
  ctx.provide('ipc',{handle:(name,handler)=>{handlers.set(name,handler);return ()=>handlers.delete(name);}});
  ctx.provide('sessions',{get:()=>({runtime:'dsh'})});
  ctx.provide('dshRuntime',{request:async(id,action,payload)=>{officialCalls++;assert.equal(id,'one');assert.equal(action,'route');assert.equal(payload.path,'/api/context/detail');return {status:200,body:'official'};}});
  new ConnectionService(ctx);ctx.connection.register({path:'/api/dyworker-trajectory/read',methods:['POST'],fetch:async request=>Response.json({actual:(await request.json()).sessionId})});
  try {await ctx.plugin(pluginApiIpcPlugin());await ctx.fiber.await();
    const fetch=handlers.get('plugin-api:fetch');
    const native=await fetch({sender:{id:1}},{requestId:'native',path:'/api/dyworker-trajectory/read?ignored=true',method:'post',body:'{"sessionId":"one"}'});
    assert.equal(native.status,200);assert.deepEqual(JSON.parse(native.body),{actual:'one'});assert.equal(officialCalls,0);
    const official=await fetch({sender:{id:1}},{requestId:'official',path:'/api/context/detail',method:'POST',body:'{"sessionId":"one"}'});
    assert.equal(official.body,'official');assert.equal(officialCalls,1);
  }finally{await ctx.fiber.dispose();}
});
