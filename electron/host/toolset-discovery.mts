// 扩展工具组按需激活：首轮只向模型暴露高频核心工具与薄索引 load_toolset，
// 停用或未接入的分组不出现在索引中；激活后工具保留原名与原有审批边界。

import { browserUseGuidance, desktopUseGuidance } from './computer-use-guidance.mts';

const OFFICE_TOOLS = new Set([
  'gov_search',
  'check_official_document',
  'calculate_workdays',
  'export_word_document',
  'export_excel_workbook',
  'office_render',
  'office_recalculate',
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
    summary: '桌面应用操作（控件、截图、点击与输入）',
    guidance: desktopUseGuidance,
  },
  browser: {
    summary: '任务独立后台浏览器或右侧面板（网页、表单、上传、接管与外部调试连接）',
    guidance: browserUseGuidance,
  },
  office: {
    summary: '政务与办公（政策检索、公文检查、工作日、Word/Excel、页面视觉自检与公式重算、脱敏、OCR）',
    guidance: [
      'Office 文档避坑红线：',
      '1. 旧格式 .doc/.xls/.ppt 不能直接由 python-docx/openpyxl/python-pptx 打开，请先转换后再编辑；',
      '2. Word(.docx) 修改已有段落必须操作 run（直接修改 paragraph.text 会静默清空格式），设置中文字体须同时写 run.font.name 与 w:eastAsia；',
      '3. PPT/Word/复杂报表改版后无法靠纯文本判断是否溢出或错位，交付前务必用 office_render 渲染关键页看图自检；',
      '4. Excel 写入公式不会自动产生缓存计算值，需调用 office_recalculate 重算并检查 #REF!/#DIV/0! 错误；严禁用 pandas 直接覆盖保存含多 Sheet/样式的已有工作簿。',
    ].join('\n'),
  },
  history_and_skills: {
    summary: '历史会话检索与技能模板管理',
  },
  file_and_wake: {
    summary: '扩展文件操作（新建目录、追加/复制/移动/删除）、当前时间与定时唤醒',
  },
  feishu: {
    summary: '飞书云文档、多维表格与电子表格读写',
  },
  plugin_authoring: {
    summary: '检查与管理本地扩展插件（安装、重载、启停、卸载）',
  },
};

const GROUP_ORDER = ['desktop', 'browser', 'office', 'history_and_skills', 'file_and_wake', 'feishu', 'plugin_authoring'] as const;

export function resolveGroupSummary(group: string, tools?: any[]): string {
  if (GROUP_META[group]?.summary) return GROUP_META[group].summary;
  if (group.startsWith('plugin_')) {
    const pluginId = group.replace(/^plugin_/, '');
    if (pluginId.includes('knowledge_base') || pluginId.includes('kb')) {
      return '知识库检索与文档导入/管理';
    }
    if (pluginId.includes('office')) {
      return 'Word、Excel、PPT 等 Office 文档创建与编辑';
    }
    if (tools && tools.length > 0) {
      const toolNames = tools.slice(0, 3).map(t => {
        const fn = t?.function || t;
        return fn?.name?.replace(/^plugin__[^_]+__/, '') || '';
      }).filter(Boolean);
      return `插件「${pluginId}」扩展工具（含 ${toolNames.join('、')}${tools.length > 3 ? ' 等' : ''}）`;
    }
    return `插件「${pluginId}」扩展工具`;
  }
  return '扩展工具集合';
}

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
  if (name.startsWith('feishu_')) return 'feishu';
  if (name === 'plugin_inspect' || name === 'plugin_manage') return 'plugin_authoring';
  if (name.startsWith('plugin__')) {
    const match = /^plugin__([a-zA-Z0-9_-]+)__/.exec(name);
    return match ? `plugin_${match[1]}` : 'plugins';
  }
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

  const discoveredGroups = [...deferredByGroup.keys()];
  const availableGroups = [
    ...GROUP_ORDER.filter(group => discoveredGroups.includes(group)),
    ...discoveredGroups.filter(group => !(GROUP_ORDER as readonly string[]).includes(group)).sort(),
  ];
  if (availableGroups.length > 0) {
    const groupLines = availableGroups
      .map(group => `${group}（${resolveGroupSummary(group, deferredByGroup.get(group))}）`)
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
