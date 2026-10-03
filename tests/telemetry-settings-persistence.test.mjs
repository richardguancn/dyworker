import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { serializeSettings, deserializeSettings, normalizeTelemetryServiceUrl } from '../electron/settings.mts';
const telemetry={serviceUrl:'http://localhost:8000',statsEnabled:true,messagesEnabled:true,notifyNewMessages:true,notifyMarketing:true,quietHours:'22:00-08:00',dailyPopupLimit:7};
test('运营设置写入文件后在全新进程中恢复，其他设置再次保存也不丢失',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dyw-settings-restart-'));
 try{
  const file=path.join(dir,'settings.json');
  await fs.writeFile(file,JSON.stringify(serializeSettings({telemetry},null)));
  const script=`import fs from 'node:fs'; import {deserializeSettings} from ${JSON.stringify(new URL('../electron/settings.mts',import.meta.url).href)}; process.stdout.write(JSON.stringify(deserializeSettings(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),null).telemetry));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),telemetry);
  const restored=deserializeSettings(JSON.parse(await fs.readFile(file,'utf8')),null);
  assert.deepEqual(deserializeSettings(serializeSettings({...restored,preventSleep:'off'},null),null).telemetry,telemetry);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
test('运营地址允许本机 HTTP 与远程 HTTPS，但不接受远程明文或带凭据/查询的地址',()=>{
 for(const value of ['http://localhost:8000','http://127.0.0.1:8000','http://[::1]:8000','https://ops.example.com']) assert.equal(normalizeTelemetryServiceUrl(value+'/'),value);
 for(const value of ['http://ops.example.com','http://localhost.evil.example','https://user:secret@ops.example.com','https://ops.example.com/?secret=x']) assert.equal(normalizeTelemetryServiceUrl(value),'');
});
test('非法非空运营地址拒绝保存，而不是静默清空',()=>{
 assert.throws(()=>serializeSettings({telemetry:{...telemetry,serviceUrl:'not a url'}},null),/运营服务地址/);
 assert.equal(deserializeSettings(serializeSettings({telemetry:{...telemetry,serviceUrl:''}},null),null).telemetry.serviceUrl,'');
});
