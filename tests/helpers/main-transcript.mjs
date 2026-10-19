import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import crypto from 'node:crypto';
import {reconcileDshMessages,patchDshAssistant} from '../../electron/host/dsh-runtime/presentation.mts';
import {formatChannelApproval} from '../../electron/channels/shared.mts';
import {findWorkspaceBlockers} from '../../electron/workspace-busy.mts';
import {settingsForSession} from '../../electron/session-model.mts';
// Exercise the actual shared main-process collector without initializing Electron or external channels.
const main=await fs.readFile(new URL('../../electron/main.mts',import.meta.url),'utf8');
const source=main.slice(main.indexOf('function createTranscriptCollector('),main.indexOf('async function runScheduledTask('));
export const createTranscriptCollector=new Function('reconcileDshMessages','patchDshAssistant','crypto',
  stripTypeScriptTypes(source)+'\nreturn createTranscriptCollector;')(reconcileDshMessages,patchDshAssistant,crypto);
export function mainScheduledEntry(deps) {
  const start=main.indexOf('async function runScheduledTask(');
  const end=main.indexOf('\n// ----',start);
  const scheduleSource=main.slice(start,end);
  return new Function(...Object.keys(deps),stripTypeScriptTypes(scheduleSource)+'\nreturn runScheduledTask;')(...Object.values(deps));
}

// runChannelTask 按「同一工作区」判忙：判定函数与提示延迟常量在 main.mts 里是模块级依赖，
// 抽取函数体时一并注入，否则 eval 出的函数体找不到 workspaceBlockers。
function channelWorkspaceBlockers(deps,workspacePath,ignoreSessionId='') {
  const entries=[];
  for (const [sessionId,state] of deps.activeAgents||new Map()) entries.push({sessionId,workspacePath:state?.workspacePath,kind:'电脑端任务'});
  for (const [sessionId,run] of deps.wakeRuns||new Map()) entries.push({sessionId,workspacePath:run?.workspacePath,kind:run?.kind||'续跑任务'});
  for (const [sessionId,run] of deps.entryRuns||new Map()) entries.push({sessionId,workspacePath:run?.workspacePath,kind:run?.kind||'另一个渠道任务'});
  return findWorkspaceBlockers(entries,workspacePath,ignoreSessionId);
}

export function mainChannelEntry(deps) {
  deps={formatChannelApproval,settingsForSession,CHANNEL_WAIT_NOTICE_DELAY_MS:5000,...deps};
  deps.workspaceBlockers=deps.workspaceBlockers||((workspacePath,ignoreSessionId)=>channelWorkspaceBlockers(deps,workspacePath,ignoreSessionId));
  const start=main.indexOf('async function runChannelTask(');
  const end=main.indexOf('\n// channels:get-status',start);
  return new Function(...Object.keys(deps),stripTypeScriptTypes('let runningChannelTaskCount=0;\n'+main.slice(start,end))+'\nreturn runChannelTask;')(...Object.values(deps));
}

export function mainWakeEntry(deps) {
  deps={settingsForSession,...deps};
  const start=main.indexOf('async function resumeWake(');
  const end=main.indexOf('\n// ----',start);
  return new Function(...Object.keys(deps),stripTypeScriptTypes(main.slice(start,end))+'\nreturn resumeWake;')(...Object.values(deps));
}
