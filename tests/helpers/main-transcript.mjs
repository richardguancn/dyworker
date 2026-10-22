import {createAutomationRuntime} from '../../electron/desktop/automation-runtime.mts';
import {createChannelRuntime} from '../../electron/desktop/channel-runtime.mts';
import {findWorkspaceBlockers} from '../../electron/workspace-busy.mts';
// 直接调用拆出的真实实现，无须再截取桌面入口源码或初始化 Electron。
export const {createTranscriptCollector}=createAutomationRuntime({});
export function mainScheduledEntry(deps) {
  return createAutomationRuntime(deps).runScheduledTask;
}

// runChannelTask 按「同一工作区」判忙，测试继续使用真实的占用判定。
function channelWorkspaceBlockers(deps,workspacePath,ignoreSessionId='') {
  const entries=[];
  for (const [sessionId,state] of deps.activeAgents||new Map()) entries.push({sessionId,workspacePath:state?.workspacePath,kind:'电脑端任务'});
  for (const [sessionId,run] of deps.wakeRuns||new Map()) entries.push({sessionId,workspacePath:run?.workspacePath,kind:run?.kind||'续跑任务'});
  for (const [sessionId,run] of deps.entryRuns||new Map()) entries.push({sessionId,workspacePath:run?.workspacePath,kind:run?.kind||'另一个渠道任务'});
  return findWorkspaceBlockers(entries,workspacePath,ignoreSessionId);
}

export function mainChannelEntry(deps) {
  deps={runningChannelTaskCount:0,...deps};
  deps.workspaceBlockers=deps.workspaceBlockers||((workspacePath,ignoreSessionId)=>channelWorkspaceBlockers(deps,workspacePath,ignoreSessionId));
  return createChannelRuntime(deps).runChannelTask;
}

export function mainWakeEntry(deps) {
  return createAutomationRuntime(deps).resumeWake;
}
