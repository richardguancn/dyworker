// 机器人（ds-bot）继承 DYWorker 桌面任务的工具能力。
//
// 设计约束：
//   - 工具描述与参数直接取应用自己的 toolDefinitions()，不另写一套，避免两处说明漂移；
//   - 执行体复用应用同一批实现（Workspace 文件与命令、联网检索、文档导出、OCR），
//     机器人的工作目录就是它们的作用域根；
//   - 审批沿用应用同一套规则：内置钩子 + 用户/工作区钩子 + 常驻允许规则 + 权限模式，
//     需要人工确认时才交给宿主提供的审批入口（机器人团队面板）。
// 机器人自己不做第二套判断：能做什么完全由上面的规则决定。
import {
  Workspace, toolDefinitions, sliceLines, scanSensitiveInfo, checkOfficialDocument,
  exportWordDocument, exportExcelWorkbook, calculateWorkdays, currentDatetime,
  webSearch, govSearch, fetchPublicPage, runOcrFile,
  builtinHooks, evaluateHooks, evaluateApproval, externalPathsForTool,
  isReviewerEligible, isReviewerProtectedPath, reviewApproval, reviewerUnavailableMessage, readReviewEntryScripts, toolSummary, htmlToText, isLikelyBackgroundCommand,
} from '../../agent.mts';
import { dshNativeSkills } from './native-skills.mts';
import { randomUUID } from 'node:crypto';
import { buildReviewContext, readReviewObservation, withReviewApprovals, reviewToolDefinition } from '../../approval-context.mts';

/** 机器人从桌面任务继承的工具名（与 toolDefinitions() 的描述/参数一一对应）。 */
export const BOT_HARNESS_TOOL_NAMES = Object.freeze([
  'list_files', 'find_files', 'search_in_files', 'read_file', 'write_file', 'edit_file', 'append_file',
  'make_directory', 'copy_file', 'move_file', 'delete_file', 'scan_sensitive_info', 'check_official_document',
  'run_command', 'get_datetime', 'web_search', 'gov_search', 'fetch_web_page', 'ocr_file',
  'export_word_document', 'export_excel_workbook', 'calculate_workdays',
  'list_skills', 'load_skill', 'save_skill', 'update_skill', 'save_memory',
  'search_history', 'read_history_context',
]);

const SKILL_TOOL_NAMES = new Set(['list_skills', 'load_skill', 'save_skill', 'update_skill']);
const HISTORY_TOOL_NAMES = new Set(['search_history', 'read_history_context']);
/** 工作区外删除不可逆：不交审核助手，直接人工确认（与桌面任务同一亮线规则）。 */
const REVIEWER_EXEMPT = new Set(['delete_file']);

function text(value: any) {
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  if (value === undefined || value === null) return '（没有返回值）';
  return JSON.stringify(value, null, 2);
}

/**
 * 机器人工具调用的审批：规则与桌面任务一致。
 * 返回 true = 允许执行；false = 拒绝（调用方据此回绝本次操作，不抛异常）。
 */
export function createBotApproval(options: any) {
  let queue = Promise.resolve();
  const approvals = new Map<string, any[]>();
  const audit = (item: any) => options.audit?.(item);
  const resolved = async (value: any) => (typeof value === 'function' ? await value() : value) || [];
  return (tool: any) => {
    const operation = queue.then(async () => {
      const { name, args = {}, signal } = tool;
      signal?.throwIfAborted();
      const workspace = tool.workspace || options.workspace;
      const workspacePath = tool.workspacePath || options.workspacePath || '';
      const mode = () => String(options.getApprovalMode?.() || options.approvalMode || 'interactive');
      const externalPaths = externalPathsForTool(workspace, name, args);
      const hook = evaluateHooks(builtinHooks, 'before_tool', name, args)
        || evaluateHooks(await resolved(options.hooks), 'before_tool', name, args)
        || await options.beforeToolExecute?.({ name, args });
      const detail = (decision: string, note = '') => audit({ tool: name, summary: `机器人：${toolSummary(name, args)}`,
        decision, detail: note, sessionId: tool.sessionId });
      if (hook?.action === 'block') { detail('blocked', hook.message); return false; }
      const standingRules = await resolved(options.standingRules);
      const evaluate = () => evaluateApproval({ name, args, approvalMode: mode(),
        hasExternalPaths: externalPaths.length > 0, hookRequiresApproval: hook?.action === 'require_approval',
        standingRules });
      const decision = evaluate();
      if (decision === 'deny') { detail('denied', '当前权限模式不允许此操作'); return false; }
      if (decision === 'allow') { detail('auto-allowed'); return true; }
      let reason = hook?.message || '';
      const reviewable = !REVIEWER_EXEMPT.has(name)
        && !isReviewerProtectedPath(workspacePath, args.path)
        && isReviewerEligible({ name, args, approvalMode: mode(), hookRequiresApproval: hook?.action === 'require_approval' && hook?.reviewable !== true,
          forExternalPaths: externalPaths.length > 0 });
      if (reviewable) {
        const reviewMode = mode();
        const observation = await readReviewObservation({ name, args, availableNames: await resolved(options.extraToolNames),
          execute: (reader: string, readArgs: any) => options.onExtraTool?.(reader, readArgs, tool), signal,
          check: async (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...await resolved(options.hooks)], 'before_tool', reader, readArgs)
            || await options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const context = withReviewApprovals(await options.getReviewContext?.(tool) || buildReviewContext({ conversation: options.conversation,
          prompt: options.context }), approvals.get(tool.sessionId || '') || []);
        const entryScripts = await readReviewEntryScripts({ workspace, name, args, signal,
          preparedFiles: (approvals.get(tool.sessionId || '') || []).filter(record => record.tool === 'write_file').map(record => record.args),
          check: async (reader: string, readArgs: any) => evaluateHooks([...builtinHooks, ...await resolved(options.hooks)], 'before_tool', reader, readArgs)
            || await options.beforeToolExecute?.({ name: reader, args: readArgs }) });
        const review = await (options.review || reviewApproval)({ settings: await resolved(options.settings), fetchImpl: options.fetchImpl,
          signal, action: { kind: name, title: `机器人：${toolSummary(name, args)}`, details: JSON.stringify(args) + entryScripts, observation,
            toolDefinition: reviewToolDefinition([...(await resolved(options.extraToolDefinitions)), ...toolDefinitions()], name), accessCheck: hook?.message },
          context, onUsage: options.onUsage });
        signal?.throwIfAborted();
        if (review.unavailable) {
          detail('reviewer-unavailable', review.reason);
          throw new Error(reviewerUnavailableMessage(review.reason));
        }
        if (mode() !== reviewMode) {
          const updated = evaluate();
          detail(updated === 'allow' ? 'auto-allowed' : 'denied', '按更新后的权限重新判断');
          return updated === 'allow';
        }
        if (review.decision === 'allow') { detail('reviewer-allowed', review.reason); return true; }
        if (review.decision === 'deny') { detail('reviewer-denied', review.reason); return false; }
        reason = `审核助手无法定夺，转人工确认：${review.reason}`;
      }
      const id = String(tool.callId || randomUUID());
      const details = [externalPaths.length
        ? `工作区外路径（批准后本次调用有效）：\n${externalPaths.join('\n')}` : '', reason,
        `执行内容：\n${text(args)}`].filter(Boolean).join('\n\n');
      const pending = options.requestApproval?.({ id, kind: name, title: `机器人要执行：${toolSummary(name, args)}`,
        details, approvalReason: reason, sessionId: tool.sessionId, tool: name, signal });
      if (!pending) { detail('denied', '没有可用的确认入口'); return false; }
      let abort: any;
      try {
        const allowed = await Promise.race([pending, new Promise((_, reject) => {
          abort = () => reject(signal?.reason || new Error('机器人团队已停用'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        })]);
        if (allowed === true) { const key = tool.sessionId || ''; const records = approvals.get(key) || []; records.push({ tool: name, args: structuredClone(args) }); approvals.set(key, records); }
        detail(allowed === true ? 'approved' : 'denied', allowed === null ? '按更新后的权限自动放行' : '');
        return allowed === true || allowed === null;
      } finally { signal?.removeEventListener?.('abort', abort); }
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
}

/**
 * 装配机器人可用的继承工具。返回 DSH 工具登记项，由宿主 ctx.tools.register 注册。
 * 未在本模块实现的名字（会话检索、插件工具、MCP 工具）交给 routeExtra 转发，
 * 与桌面任务走同一个执行入口。
 */
export function createBotHarnessTools(options: any) {
  // ctx = 机器人自己的运行环境（只用来注册工具）；hostCtx = 应用宿主
  // （技能、长期记忆、历史检索、后台任务、插件工具都在宿主里）。
  const { workspacePath, approve, routeExtra, readSettings } = options;
  const hostCtx = options.hostCtx || options.ctx;
  const workspace = options.workspace || new Workspace(workspacePath, {});
  const fetchImpl = (...args: any[]) => (globalThis.fetch as any)(...args);
  let skills: any[] = [];
  let skillsLoaded = false;
  const readSkills = async () => {
    skills = (hostCtx.skills?.read ? await hostCtx.skills.read(workspacePath) : []) || [];
    skillsLoaded = true;
    return skills;
  };
  const skillTools = dshNativeSkills([], { read: readSkills, signal: options.signal,
    append: (item: any) => hostCtx.skills.append(item), update: (item: any) => hostCtx.skills.update(item) });

  const handlers: Record<string, (args: any, exec: any) => Promise<string>> = {
    list_files: async args => workspace.listFiles(args.path),
    find_files: async args => workspace.findFiles(args.pattern, args.path),
    search_in_files: async args => workspace.searchInFiles(args.query, args.path),
    read_file: async args => sliceLines(await workspace.readFile(args.path), args.offset, args.limit),
    write_file: async args => workspace.writeFile(args.path, args.content),
    edit_file: async args => workspace.editFile(args.path, args.find, args.replace, args.replace_all === true),
    append_file: async args => workspace.appendFile(args.path, args.content),
    make_directory: async args => workspace.makeDirectory(args.path),
    copy_file: async args => workspace.copyFile(args.source, args.target),
    move_file: async args => workspace.moveFile(args.source, args.target),
    delete_file: async args => workspace.deleteFile(args.path),
    scan_sensitive_info: async args => scanSensitiveInfo(workspace, args.path),
    check_official_document: async args => checkOfficialDocument(workspace, args.path),
    get_datetime: async () => currentDatetime(),
    run_command: async (args, exec) => {
      // 后台任务管理器由插件创建，可能不存在；cordis 直接读未提供的服务会抛错，必须用 get。
      const background = typeof hostCtx.get === 'function' ? hostCtx.get('backgroundTasksManager') : undefined;
      if ((args.background === true || isLikelyBackgroundCommand(args.command)) && typeof background?.startTask === 'function') {
        try {
          const task = await background.startTask({ command: args.command, cwd: workspace.root, sessionId: String(exec?.agent?.id || '') });
          return `后台服务已成功启动（任务 ID: ${task.id}，PID: ${task.pid || '未知'}）。`
            + (task.ports?.length ? `\n监听端口: ${task.ports.join(', ')}` : '')
            + (task.urls?.length ? `\n访问地址: ${task.urls.join(', ')}` : '')
            + '\n服务已在后台保持运行，可在工作台「后台任务」面板查看输出或关闭。';
        } catch (error: any) { return `后台服务启动失败: ${error?.message || error}`; }
      }
      const result = await workspace.runCommand(args.command);
      return result.ok ? result.output : `失败：${result.output}`;
    },
    web_search: async args => webSearch(fetchImpl, args.query, Number(args.limit) || 10, await readSettings()),
    gov_search: async args => govSearch(fetchImpl, args.query, Number(args.limit) || 8, await readSettings()),
    fetch_web_page: async args => {
      const page = await fetchPublicPage(fetchImpl, args.url);
      return `网页地址：${page.url}\n\n${htmlToText(page.body)}`;
    },
    ocr_file: async args => runOcrFile(workspace, await readSettings(), fetchImpl, args),
    export_word_document: async args => exportWordDocument(workspace, args.path, args.title, args.content),
    export_excel_workbook: async args => exportExcelWorkbook(workspace, args.path, args.sheets),
    calculate_workdays: async args => calculateWorkdays({ startDate: args.start_date, days: args.days, endDate: args.end_date }),
    save_memory: async (args, exec) => {
      const content = String(args.content || '').trim();
      if (!content) throw new Error('记忆内容不能为空');
      if (!hostCtx.memory?.append) throw new Error('当前环境没有可用的长期记忆服务');
      const record = await hostCtx.memory.append({ category: String(args.category || '常用信息'), content,
        name: String(args.name || '').trim().slice(0, 30), kind: String(args.kind || 'fact'),
        scope: String(args.scope || 'global'), relation: String(args.relation || 'extends'),
        relatedMemoryId: String(args.related_memory_id || '') }, workspacePath, String(exec?.agent?.id || ''));
      if (!record) throw new Error('记忆未保存');
      return `记忆已保存，编号：${record.id}`;
    },
    search_history: async args => {
      const history = hostCtx.agent?.resolvers?.history?.();
      if (!history) throw new Error('当前环境没有历史检索入口');
      return history.search(args.query, Number(args.limit) || 10, Number(args.offset) || 0);
    },
    read_history_context: async args => {
      const history = hostCtx.agent?.resolvers?.history?.();
      if (!history) throw new Error('当前环境没有历史检索入口');
      return history.readContext(args.session_id, Number(args.message_index) || 0,
        Number(args.before ?? 4), Number(args.after ?? 4));
    },
  };

  const inherited = toolDefinitions()
    .filter(tool => BOT_HARNESS_TOOL_NAMES.includes(tool.function.name))
    .map(tool => tool.function);
  // 会话检索、插件工具、MCP 工具由宿主转交同一执行入口，描述/参数也用宿主现成的定义。
  const delegated = (options.extraDefinitions || []).map((tool: any) => tool.function ?? tool);
  const definitions = new Map<string, any>([...inherited, ...delegated]
    .filter((tool: any) => tool?.name)
    .map((tool: any) => [tool.name, tool]));

  const execute = async (name: string, args: any, exec: any) => {
    const allowed = await approve({ name, args, sessionId: String(exec?.agent?.id || ''),
      callId: exec?.callId, signal: exec?.signal, workspace, workspacePath });
    if (!allowed) return `用户没有允许这次「${name}」操作，本次调用已取消。请改用其他方式，或先向用户说明为什么需要这个操作。`;
    if (!handlers[name] && !SKILL_TOOL_NAMES.has(name) && !HISTORY_TOOL_NAMES.has(name)) {
      if (typeof routeExtra !== 'function') throw new Error(`机器人没有继承工具：${name}`);
      return text(await routeExtra(name, args, { ...exec, sessionId: String(exec?.agent?.id || '') }));
    }
    const externalPaths = externalPathsForTool(workspace, name, args);
    const release = externalPaths.length ? workspace.authorizeExternalPaths(externalPaths) : undefined;
    try {
      if (SKILL_TOOL_NAMES.has(name)) {
        if (!skillsLoaded) await readSkills();
        return text(await skillTools.execute(name, args));
      }
      return text(await handlers[name](args, exec));
    } finally { release?.(); }
  };

  const tools = [...definitions.entries()].map(([name, definition]) => ({
    name, description: definition.description, parameters: definition.parameters, inherited: true, execute,
  }));
  return { tools, execute, owns: (name: string) => Boolean(handlers[name]) || SKILL_TOOL_NAMES.has(name) || HISTORY_TOOL_NAMES.has(name) };
}
