// 第二层运行环境使用官方任务驱动和会话持久化；数据属于 DSH，不覆盖 DYWorker 历史。
import { Context } from '@deepseek-ai/cordis';
import Llm from '@deepseek-ai/dsh-llm';
import Sessions from '@deepseek-ai/dsh-session';
import Projections from '@deepseek-ai/dsh-session-projection';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Query from '@deepseek-ai/dsh-session-query-sqlite';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import ProjectionCache from '@deepseek-ai/dsh-session-projection-cache';
import FileSystem from '@deepseek-ai/dsh-fs-local';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import Compaction from '@deepseek-ai/dsh-compaction-basic';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as SpawnSubagent from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as ForkSubagent from '@deepseek-ai/dsh-subagent-fork-in-process';
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent';
import * as SubagentControl from '@deepseek-ai/dsh-tool-subagent-control';
import UserQuestions from '@deepseek-ai/dsh-user-questions';
import * as AskUser from '@deepseek-ai/dsh-tool-ask-user';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Workflow from '@deepseek-ai/dsh-workflow-ptc';
import * as WorkflowTool from '@deepseek-ai/dsh-tool-workflow';
import Jobs from '@deepseek-ai/dsh-jobs-local';
import * as JobTools from '@deepseek-ai/dsh-tool-jobs';
import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
import Commands from '@deepseek-ai/dsh-commands';
import SessionTitle from '@deepseek-ai/dsh-session-title';
import FileUploads from '@deepseek-ai/dsh-client-file-upload';
import { ConnectionService } from '../services/connection.mts';
import path from 'node:path';

export async function createOfficialDshContext({ dataDir, workspacePath, persistence, ptc, attachments }: { dataDir: string; workspacePath: string; persistence?: any; ptc?: any; attachments?: any }) {
  const ctx = new Context();
  try {
    await ctx.plugin(Llm);
    await ctx.plugin(Sessions);
    await ctx.plugin(Projections);
    await ctx.plugin(SessionTitle, {fallbackMaxWords:5,fallbackMaxBytes:40,maxTitleBytes:80});
    await ctx.plugin(Prompt, { includeHarnessIdentity: false });
    await ctx.plugin(Tools, { mode: 'native' });
    await ctx.plugin(Agents);
    await ctx.plugin(attachments || LocalAttachments, { dshHome: path.join(dataDir, 'attachment-home') });
    await ctx.plugin(FileSystem, { cwd: workspacePath, diffBasisMaxBytes: 10 * 1024 * 1024 });
    if (persistence) await ctx.plugin(persistence);
    else await ctx.plugin(Persistence, { root: path.join(dataDir, 'sessions'), compression: 'none' });
    await ctx.plugin(Query, { path: ':memory:', openAt: 'first-search' });
    await ctx.plugin(Storage);
    await ctx.plugin(JsonStorage, { root: path.join(dataDir, 'storages') });
    await ctx.plugin(StorageDomain, { backend: 'json' });
    await ctx.plugin(ProjectionCache, { writeEveryEvents: 200, writeIntervalMs: 5000 });
    await ctx.plugin(TokenMeter);
    await ctx.plugin(Compaction);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(Subagents);
    await ctx.plugin(SpawnSubagent);
    await ctx.plugin(ForkSubagent);
    await ctx.plugin(SubagentTool, { provider: 'spawn', toolName: 'subagent', backgroundMode: 'continuable' });
    await ctx.plugin(SubagentTool, { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'one-shot' });
    await ctx.plugin(SubagentControl);
    await ctx.plugin(UserQuestions);
    await ctx.plugin(AskUser, { mode: 'legacy' });
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: workspacePath });
    await ctx.plugin(Jobs);
    await ctx.plugin(JobTools, { completionDelivery: 'wakeup', maxConsecutiveWakes: 8 });
    if (ptc) {
      await ctx.plugin(ptc.plugin, { timeoutMs: 120_000, maxTimeoutMs: 600_000, graceMs: 1000 });
      await ctx.plugin(Workflow, { provider: 'spawn', maxConcurrentAgents: 4 });
      await ctx.plugin(WorkflowTool, { enableRunInBackground: true });
      ptc.wrap((ctx.tools as any).get('workflow'));
    }
    new ConnectionService(ctx);
    await ctx.plugin(Commands);
    await ctx.plugin(FileUploads);
    await ctx.fiber.await();
    return ctx;
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
