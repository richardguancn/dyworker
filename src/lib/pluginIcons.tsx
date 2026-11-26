import type { ComponentType, CSSProperties } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Blocks,
  BookOpen,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Cloud,
  Code2,
  Database,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Gauge,
  Globe,
  Layers,
  LayoutGrid,
  LineChart,
  Link2,
  Mail,
  MessageSquare,
  NotebookPen,
  PieChart,
  Search,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Table2,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { PluginIcon } from "../PluginIcon";
import type { PluginCustomization } from "../types";

export interface PluginIconPreset {
  id: string;
  label: string;
  category: string;
  keywords: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

/** 系统内置插件图标库（基于 lucide-react，覆盖看板、文档、工具、协作与开发场景） */
export const PLUGIN_ICON_PRESETS: PluginIconPreset[] = [
  { id: "layout-grid", label: "工作台", category: "看板数据", keywords: "board grid dashboard 看板 页面 工作台", icon: LayoutGrid },
  { id: "bar-chart-3", label: "柱状图", category: "看板数据", keywords: "chart bar stats 柱状图 统计 报表", icon: BarChart3 },
  { id: "line-chart", label: "趋势折线", category: "看板数据", keywords: "chart line trend 折线 趋势 指标", icon: LineChart },
  { id: "pie-chart", label: "占比饼图", category: "看板数据", keywords: "chart pie share 饼图 占比 分析", icon: PieChart },
  { id: "table-2", label: "数据表格", category: "看板数据", keywords: "table sheet grid 表格 台账 清单", icon: Table2 },
  { id: "database", label: "数据库", category: "看板数据", keywords: "db data store 数据库 存储 记录", icon: Database },
  { id: "activity", label: "监控脉搏", category: "看板数据", keywords: "pulse monitor status 监控 状态 实时", icon: Activity },
  { id: "gauge", label: "仪表盘", category: "看板数据", keywords: "gauge kpi meter 仪表盘 进度 指标", icon: Gauge },

  { id: "file-text", label: "文档", category: "文档办公", keywords: "doc file text 文档 公文 报告", icon: FileText },
  { id: "file-spreadsheet", label: "电子表格", category: "文档办公", keywords: "excel csv sheet 表格 报表 飞书", icon: FileSpreadsheet },
  { id: "clipboard-check", label: "核查清单", category: "文档办公", keywords: "checklist todo audit 清单 审校 打卡", icon: ClipboardCheck },
  { id: "notebook-pen", label: "笔记记录", category: "文档办公", keywords: "note write log 笔记 纪要 日报", icon: NotebookPen },
  { id: "book-open", label: "知识手册", category: "文档办公", keywords: "book wiki guide 知识库 手册 文档", icon: BookOpen },
  { id: "folder-kanban", label: "项目看板", category: "文档办公", keywords: "project kanban task 项目 任务 进度", icon: FolderKanban },
  { id: "calendar-days", label: "日程排期", category: "文档办公", keywords: "calendar schedule date 日程 计划 里程碑", icon: CalendarDays },
  { id: "briefcase", label: "办公事务", category: "文档办公", keywords: "work business office 办公 项目 业务", icon: Briefcase },

  { id: "wrench", label: "实用工具", category: "效率工具", keywords: "tool utility fix 工具 助手 处理", icon: Wrench },
  { id: "sparkles", label: "智能助手", category: "效率工具", keywords: "ai smart magic 智能 创造 灵感", icon: Sparkles },
  { id: "zap", label: "快捷动作", category: "效率工具", keywords: "fast action auto 效率 自动化 快捷", icon: Zap },
  { id: "clock", label: "时间追踪", category: "效率工具", keywords: "time timer watch 时间 定时 计时", icon: Clock },
  { id: "bell", label: "消息提醒", category: "效率工具", keywords: "notify alert reminder 通知 提醒 预警", icon: Bell },
  { id: "search", label: "检索查询", category: "效率工具", keywords: "find search query 搜索 检索 查询", icon: Search },
  { id: "sliders-horizontal", label: "配置调节", category: "效率工具", keywords: "config setting filter 配置 参数 筛选", icon: SlidersHorizontal },
  { id: "layers", label: "多维视图", category: "效率工具", keywords: "layers stack view 图层 模块 视图", icon: Layers },

  { id: "globe", label: "网页站点", category: "协作连接", keywords: "web site browser 网页 门户 链接", icon: Globe },
  { id: "link-2", label: "外部接入", category: "协作连接", keywords: "link webhook connect 连接 接入 同步", icon: Link2 },
  { id: "message-square", label: "对话沟通", category: "协作连接", keywords: "chat message talk 对话 话术 沟通", icon: MessageSquare },
  { id: "mail", label: "邮件往来", category: "协作连接", keywords: "email inbox mail 邮件 通知 函件", icon: Mail },
  { id: "users", label: "团队协作", category: "协作连接", keywords: "team people member 团队 协作 成员", icon: Users },
  { id: "share-2", label: "分享协作", category: "协作连接", keywords: "share export lan 分享 导出 协同", icon: Share2 },
  { id: "cloud", label: "云端同步", category: "协作连接", keywords: "cloud sync feishu 云文档 飞书 同步", icon: Cloud },
  { id: "send", label: "分发推送", category: "协作连接", keywords: "send push publish 发送 推送 发布", icon: Send },

  { id: "terminal", label: "终端命令", category: "研发拓展", keywords: "cli shell command 终端 命令 脚本", icon: Terminal },
  { id: "code-2", label: "开发扩展", category: "研发拓展", keywords: "code dev script 代码 脚本 开发", icon: Code2 },
  { id: "blocks", label: "积木模块", category: "研发拓展", keywords: "plugin module blocks 插件 模块 扩展", icon: Blocks },
  { id: "star", label: "精选收藏", category: "研发拓展", keywords: "star favorite pin 精选 常用 收藏", icon: Star },
];

const ICON_PRESET_MAP = new Map(PLUGIN_ICON_PRESETS.map((item) => [item.id, item]));

export interface PluginColorPreset {
  hex: string;
  label: string;
}

/** 适配深浅色主题的 12 个精选图标主色 */
export const PLUGIN_COLOR_PRESETS: PluginColorPreset[] = [
  { hex: "#4f46e5", label: "靛蓝" },
  { hex: "#2563eb", label: "晴空蓝" },
  { hex: "#0891b2", label: "青碧" },
  { hex: "#059669", label: "翡翠绿" },
  { hex: "#65a30d", label: "苔原绿" },
  { hex: "#d97706", label: "琥珀金" },
  { hex: "#ea580c", label: "暖橙" },
  { hex: "#e11d48", label: "珊瑚红" },
  { hex: "#db2777", label: "玫粉" },
  { hex: "#7c3aed", label: "紫罗兰" },
  { hex: "#475569", label: "石板灰" },
  { hex: "#0f766e", label: "深松石" },
];

const DEFAULT_TILE_COLORS = ["#e8eefc", "#e9f5ea", "#fdf1e3", "#f3e9fb", "#e6f3f7", "#fdecec"];

export function defaultTileColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  return DEFAULT_TILE_COLORS[hash % DEFAULT_TILE_COLORS.length];
}

export function normalizeHexColor(value: unknown): string {
  const raw = String(value || "").trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw) ? raw.toLowerCase() : "";
}

export function normalizeIconId(value: unknown): string {
  const raw = String(value || "").trim();
  return ICON_PRESET_MAP.has(raw) ? raw : "";
}

export interface ResolvedPluginVisual {
  iconId: string;
  iconColor: string;
  displayName: string;
  author: string;
  hasCustom: boolean;
  primaryKey: string;
}

/**
 * 统一解析插件外观与展示信息：
 * 优先级为「用户自定义 settings.pluginCustomizations」>「插件包声明(manifest/bundle/slot)」>「默认值」。
 */
export function resolvePluginVisual(
  keys: Array<string | undefined | null>,
  customizations: Record<string, PluginCustomization> | undefined,
  defaults: {
    displayName?: string;
    author?: string;
    icon?: string;
    iconColor?: string;
  } = {},
): ResolvedPluginVisual {
  const cleanedKeys = keys.map((k) => String(k || "").trim()).filter(Boolean);
  const primaryKey = cleanedKeys[0] || "";
  const map = customizations || {};
  let matched: PluginCustomization | undefined;
  for (const key of cleanedKeys) {
    if (map[key]) {
      matched = map[key];
      break;
    }
  }

  const iconId = normalizeIconId(matched?.icon) || normalizeIconId(defaults.icon);
  const iconColor = normalizeHexColor(matched?.iconColor) || normalizeHexColor(defaults.iconColor);
  const displayName = String(matched?.displayName || defaults.displayName || "").trim();
  const author = String(matched?.author || defaults.author || "").trim();
  const hasCustom = Boolean(
    matched && (matched.icon || matched.iconColor || matched.displayName || matched.author),
  );

  return { iconId, iconColor, displayName, author, hasCustom, primaryKey };
}

/** 生成插件列表卡片 / 详情页图标容器样式：有自定义颜色时自动混入 16% 底色并用该色着色图标 */
export function pluginTileStyle(iconColor: string, fallbackSeed: string): CSSProperties {
  if (iconColor) {
    return {
      "--plugin-tile": iconColor,
      color: iconColor,
      background: `color-mix(in srgb, ${iconColor} 16%, transparent)`,
      borderColor: `color-mix(in srgb, ${iconColor} 28%, transparent)`,
    } as CSSProperties;
  }
  return {
    "--plugin-tile": defaultTileColor(fallbackSeed),
  } as CSSProperties;
}

export function PluginGlyph({
  iconId,
  color,
  size = 18,
  className,
  fallback = "plugin",
}: {
  iconId?: string;
  color?: string;
  size?: number;
  className?: string;
  fallback?: "plugin" | "workspace-page";
}) {
  const preset = iconId ? ICON_PRESET_MAP.get(iconId) : undefined;
  const style = color ? ({ color } as CSSProperties) : undefined;
  if (preset) {
    const Comp = preset.icon;
    return <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}><Comp size={size} /></span>;
  }
  if (fallback === "workspace-page") {
    return <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}><LayoutGrid size={size} /></span>;
  }
  return <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}><PluginIcon size={size} /></span>;
}
