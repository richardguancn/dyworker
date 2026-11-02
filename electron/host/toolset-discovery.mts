// 扩展工具组按需激活：首轮只向模型暴露高频核心工具与薄索引 load_toolset，
// 停用或未接入的分组不出现在索引中；激活后工具保留原名与原有审批边界。

const OFFICE_TOOLS = new Set([
  'gov_search',
  'check_official_document',
  'calculate_workdays',
  'export_word_document',
  'export_excel_workbook',
  'scan_sensitive_info',
  'ocr_file',
]);

const SESSION_HISTORY_TOOLS = new Set(['list_sessions', 'search_sessions', 'read_session']);
const LEGACY_HISTORY_TOOLS = new Set(['search_history', 'read_history_context']);
const SKILL_MUTATION_TOOLS = new Set(['list_skills', 'save_skill', 'update_skill']);

const FILE_AND_WAKE_TOOLS = new Set([
  'make_directory',
  'append_file',
  'copy_file',
  'move_file',
  'delete_file',
  'get_datetime',
  'sleep_until',
]);

const GROUP_META: Record<string, { summary: string; guidance?: string }> = {
  desktop: {
    summary: '操控本机桌面应用界面（启动应用、查看窗口控件、点击/输入/按键/权限与依赖检查）',
    guidance: '本机应用操作守则：应用未运行时先 launch_app；首次操作应用前先 get_app_state，后续交互原样传 window_id 并每次重新获取状态；macOS 缺权限先调 check_permissions；Linux 缺组件依次用 check_dependencies、prepare_dependency_install、取得确认后原样传 packages/plan_token/plan_summary 调 install_dependencies（勿用 sudo）。',
  },
  browser: {
    summary: '右侧内置可见浏览器（打开网页、查看可交互快照、点击/输入/等待、下载记录与转交人工）',
    guidance: '浏览器协作守则：操作网页统一用 browser__* 在右侧可见窗口进行；每次点击/输入前先用 browser__observe 或 browser__snapshot 核对元素，遇登录/验证码用 browser__handoff 交用户完成。',
  },
  office: {
    summary: '政务与办公专项（gov.cn 政策检索、公文格式检查、工作日推算、导出 Word/Excel、敏感信息扫描、OCR）',
  },
  history_and_skills: {
    summary: '跨会话历史检索与工作模板管理（搜索/读取过往会话、列出/保存/更新技能模板）',
  },
  file_and_wake: {
    summary: '扩展文件操作与定时唤醒（新建目录、追加/复制/移动/删除文件、获取当前时间、挂起任务 sleep_until）',
  },
};

const GROUP_ORDER = ['desktop', 'browser', 'office', 'history_and_skills', 'file_and_wake'] as const;

function toolNameOf(tool: any): string {
  return String((tool?.function || tool)?.name || '');
}

function classifyGroup(name: string, identity: string): string | null {
  if (name.startsWith('mcp__computer-use__')) return 'desktop';
  if (name.startsWith('browser__')) return 'browser';
  if (OFFICE_TOOLS.has(name)) return identity === 'government' ? null : 'office';
  if (SESSION_HISTORY_TOOLS.has(name) || LEGACY_HISTORY_TOOLS.has(name) || SKILL_MUTATION_TOOLS.has(name)) {
    return 'history_and_skills';
  }
  if (FILE_AND_WAKE_TOOLS.has(name)) return 'file_and_wake';
  return null;
}

export function prepareToolsetDiscovery(
  tools: any[],
  options: { identity?: string; pinnedNames?: Iterable<string> } = {},
) {
  const identity = String(options.identity || 'general');
  const pinned = new Set(options.pinnedNames || []);
  const hasSessionTools = (tools || []).some(tool => SESSION_HISTORY_TOOLS.has(toolNameOf(tool)));

  const initial: any[] = [];
  const deferredByGroup = new Map<string, any[]>();

  for (const tool of tools || []) {
    const name = toolNameOf(tool);
    if (!name) continue;
    // 已注入新版跨会话检索工具时，隐藏功能重叠的旧版 search_history / read_history_context
    if (hasSessionTools && LEGACY_HISTORY_TOOLS.has(name) && !pinned.has(name)) continue;
    if (pinned.has(name)) {
      initial.push(tool);
      continue;
    }
    const group = classifyGroup(name, identity);
    if (!group) {
      initial.push(tool);
      continue;
    }
    const bucket = deferredByGroup.get(group) || [];
    bucket.push(tool);
    deferredByGroup.set(group, bucket);
  }

  const availableGroups = GROUP_ORDER.filter(group => (deferredByGroup.get(group)?.length || 0) > 0);
  if (availableGroups.length > 0) {
    const groupLines = availableGroups
      .map(group => `${group}（${GROUP_META[group].summary}）`)
      .join('；');
    initial.push({
      type: 'function',
      function: {
        name: 'load_toolset',
        description: `按需加载扩展工具组，加载后下一轮即可直接调用对应工具。可用分组：${groupLines}。`,
        parameters: {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              description: '要激活的工具组名称列表（可一次传多个）',
              items: { type: 'string', enum: availableGroups },
            },
          },
          required: ['groups'],
        },
      },
    });
  }

  return { initial, deferredByGroup, availableGroups };
}

export function activateToolsets(deferredByGroup: Map<string, any[]>, rawGroups: unknown) {
  const requested = (Array.isArray(rawGroups) ? rawGroups : typeof rawGroups === 'string' ? [rawGroups] : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  const tools: any[] = [];
  const guidances: string[] = [];
  const unknown: string[] = [];

  for (const group of new Set(requested)) {
    const bucket = deferredByGroup.get(group);
    if (!bucket || !bucket.length) {
      unknown.push(group);
      continue;
    }
    for (const tool of bucket) {
      if (!tools.some(existing => toolNameOf(existing) === toolNameOf(tool))) {
        tools.push(tool);
      }
    }
    const guidance = GROUP_META[group]?.guidance;
    if (guidance) guidances.push(guidance);
  }

  if (!tools.length) {
    const valid = [...deferredByGroup.keys()];
    return {
      tools: [],
      text: valid.length
        ? `未找到匹配的工具组（传入：${requested.join(', ') || '空'}）。可用工具组：${valid.join(', ')}。`
        : '当前没有可额外加载的扩展工具组。',
    };
  }

  const lines = tools.map(tool => {
    const fn = tool?.function || tool;
    return `- ${fn.name}：${String(fn.description || '').split('\n')[0]}`;
  });
  const parts = [
    `已激活 ${tools.length} 个工具（下一轮请求可直接调用）：\n${lines.join('\n')}`,
    ...guidances,
    unknown.length ? `忽略了不存在的分组：${unknown.join(', ')}` : '',
  ].filter(Boolean);

  return { tools, text: parts.join('\n\n') };
}
