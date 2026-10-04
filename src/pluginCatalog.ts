// 插件市场：精选的 DSH 插件清单（面向办公 / 政务场景）。
//
// 为什么内置一份清单而不是实时抓 GitHub：
//   1. 应用要能离线打开插件页——网络不可用时市场不该变成空白；
//   2. 清单是**人挑过的**：只收录办公/政务/文档这条线，避免把 1.7 万个 topic 仓库全倒给用户；
//   3. star 数只是排序参考，写进清单时会带上抓取日期，界面上如实标注"非实时"。
//
// 安装一律走既有的「添加插件」流程（兼容性判定 → 安装），市场只负责**发现与预填**，
// 不自己偷偷装东西——这样"装上了"与"能用"仍然是分开的结论。

export interface CatalogPlugin {
  /** 稳定 id（仓库全名），用于去重与已安装匹配 */
  id: string;
  /** 仓库全名 owner/repo */
  repo: string;
  /** 包名（npm 上的名字；安装时用 github: 源，此处用于识别"已安装"） */
  packageName: string;
  /** star 数（清单生成时的快照） */
  stars: number;
  /** 一句话说明，尽量忠实于仓库描述 */
  summary: string;
  /** 分类：办公 / 政务公文 / 文档解析 / 效率工具 */
  category: string;
  /** 关键词，供搜索 */
  tags: string[];
  /** 安装输入（我们的安装流程认识的写法） */
  install: string;
  /** 是否已在本机验证过界面半边能跑（我们实测过的才标） */
  verified?: boolean;
}

/** star 数与描述的抓取日期：界面上如实标注，避免被当成实时数据 */
export const CATALOG_SNAPSHOT_DATE = "2026-10-04";

export const CATALOG_CATEGORIES = ["办公", "政务公文", "文档解析", "效率工具"] as const;

export const PLUGIN_CATALOG: CatalogPlugin[] = [
  // ── 办公 ─────────────────────────────────────────────────────────────
  {
    id: "dream-num/dsh-univer-office",
    repo: "dream-num/dsh-univer-office",
    packageName: "dsh-univer-office",
    stars: 463,
    summary: "Univer Office 插件：给 DSH 一套真实的办公环境（表格 / 文档 / 幻灯片）。",
    category: "办公",
    tags: ["office", "excel", "docx", "pptx", "表格", "三件套"],
    install: "github:dream-num/dsh-univer-office",
  },
  {
    id: "FylarOpen/dsh-fylar-office-editor",
    repo: "FylarOpen/dsh-fylar-office-editor",
    packageName: "@fylar/dsh-fylar-office-editor",
    stars: 144,
    summary: "Office 文档预览、编辑，以及 DOCX 生成。",
    category: "办公",
    tags: ["office", "docx", "预览", "编辑"],
    install: "github:FylarOpen/dsh-fylar-office-editor",
  },
  {
    id: "omdsh-dev/dsh-office",
    repo: "omdsh-dev/dsh-office",
    packageName: "@huiliyi37/dsh-office",
    stars: 26,
    summary: "办公三件套文档工具：生成与读取。",
    category: "办公",
    tags: ["office", "docx", "xlsx", "生成"],
    install: "github:omdsh-dev/dsh-office",
  },
  {
    id: "kw78/dsh-office-tools",
    repo: "kw78/dsh-office-tools",
    packageName: "dsh-office-tools",
    stars: 26,
    summary: "面向模型的 Office 工具：Word（.docx）等文档读写。",
    category: "办公",
    tags: ["office", "docx", "工具"],
    install: "github:kw78/dsh-office-tools",
  },

  // ── 政务公文 ─────────────────────────────────────────────────────────
  {
    id: "linhut/gongwen-skill",
    repo: "linhut/gongwen-skill",
    packageName: "gongwen-skill",
    stars: 71,
    summary: "公文全流程处理，基于 GB/T 9704《党政机关公文格式》国标，支持格式检查与写作。",
    category: "政务公文",
    tags: ["公文", "GB/T 9704", "格式检查", "写作", "wps"],
    install: "github:linhut/gongwen-skill",
  },
  {
    id: "ExElectron/dsh-tool-hongtou",
    repo: "ExElectron/dsh-tool-hongtou",
    packageName: "dsh-tool-hongtou",
    stars: 27,
    summary: "红头公文：LLM 结构化提纲 + 确定性的 Word 2003 XML 版式渲染，两阶段解耦。",
    category: "政务公文",
    tags: ["红头文件", "公文", "word", "排版"],
    install: "github:ExElectron/dsh-tool-hongtou",
  },
  {
    id: "GitTOU/dsh-tool-gbt9704",
    repo: "GitTOU/dsh-tool-gbt9704",
    packageName: "dsh-tool-gbt9704",
    stars: 3,
    summary: "Markdown / Word 一键排版为 GB/T 9704 党政机关公文格式。",
    category: "政务公文",
    tags: ["GB/T 9704", "公文", "排版"],
    install: "github:GitTOU/dsh-tool-gbt9704",
  },
  {
    id: "Ramenne/DeepSeek-Harness-Gov",
    repo: "Ramenne/DeepSeek-Harness-Gov",
    packageName: "deepseek-harness-gov",
    stars: 11,
    summary: "政务版：在 DSH 之上的政务办事 WebUI。",
    category: "政务公文",
    tags: ["政务", "办事", "webui"],
    install: "github:Ramenne/DeepSeek-Harness-Gov",
  },
  {
    id: "onlyLT/tizhi-agent",
    repo: "onlyLT/tizhi-agent",
    packageName: "tizhi-agent",
    stars: 6,
    summary: "体制.agent：把「体制内」的写作与沟通语气做成 agent preset。",
    category: "政务公文",
    tags: ["体制", "preset", "公文"],
    install: "github:onlyLT/tizhi-agent",
  },

  // ── 文档解析 ─────────────────────────────────────────────────────────
  {
    id: "HuanLinOTO/dsh-plugin-mineru",
    repo: "HuanLinOTO/dsh-plugin-mineru",
    packageName: "dsh-plugin-mineru",
    stars: 46,
    summary: "接入 MinerU：把 PDF / 图片 / DOCX / PPTX / XLSX 解析成结构化 Markdown 或 JSON。",
    category: "文档解析",
    tags: ["pdf", "ocr", "docx", "解析", "mineru"],
    install: "github:HuanLinOTO/dsh-plugin-mineru",
  },
  {
    id: "taxueseek/dsh-files",
    repo: "taxueseek/dsh-files",
    packageName: "dsh-files",
    stars: 40,
    summary: "原生上传管线上的文件夹按钮 + read_document 文档解析（PDF / DOCX 等）。",
    category: "文档解析",
    tags: ["上传", "文件夹", "read_document", "pdf"],
    install: "github:taxueseek/dsh-files",
  },
  {
    id: "Sqhao-O/dsh-docs",
    repo: "Sqhao-O/dsh-docs",
    packageName: "dsh-docs",
    stars: 14,
    summary: "完全本地的文档智能解析。",
    category: "文档解析",
    tags: ["本地", "文档", "解析"],
    install: "github:Sqhao-O/dsh-docs",
  },
  {
    id: "beancookie/dsh-plugin-anydoc",
    repo: "beancookie/dsh-plugin-anydoc",
    packageName: "dsh-plugin-anydoc",
    stars: 7,
    summary: "基于 anydoc：Word / PPT / Excel / PDF / EPUB / CSV 转文本。",
    category: "文档解析",
    tags: ["anydoc", "转换", "pdf", "csv"],
    install: "github:beancookie/dsh-plugin-anydoc",
  },

  // ── 效率工具 ─────────────────────────────────────────────────────────
  {
    id: "bowenliang123/dsh-context",
    repo: "bowenliang123/dsh-context",
    packageName: "dsh-context",
    stars: 1829,
    summary: "上下文洞察与管理：把每一轮的上下文占用、注入、压缩与文件活动摊开看。",
    category: "效率工具",
    tags: ["上下文", "token", "洞察", "管理"],
    install: "dsh-context",
    verified: true,
  },
  {
    id: "EthanYoQ/Invoice-Downloader",
    repo: "EthanYoQ/Invoice-Downloader",
    packageName: "invoice-downloader",
    stars: 484,
    summary: "电子发票整理与报销准备：从邮箱批量收集 PDF / OFD / XML，OCR 识别、分类归档并生成 Excel 汇总。",
    category: "效率工具",
    tags: ["发票", "报销", "excel", "ocr", "邮箱"],
    install: "github:EthanYoQ/Invoice-Downloader",
  },
];

/** 按 star 数从高到低（清单展示顺序；同一分类内也照此排） */
export function catalogSorted(): CatalogPlugin[] {
  return [...PLUGIN_CATALOG].sort((a, b) => b.stars - a.stars);
}

/** 关键词过滤：命中名称、说明、标签或分类任意一项 */
export function filterCatalog(keyword: string, category = ""): CatalogPlugin[] {
  const needle = keyword.trim().toLowerCase();
  return catalogSorted().filter((plugin) => {
    if (category && plugin.category !== category) return false;
    if (!needle) return true;
    const haystack = [plugin.repo, plugin.packageName, plugin.summary, plugin.category, ...plugin.tags].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

/**
 * 判断某个市场条目是否已经装上了。
 * 插件条目里的 id/name 可能是包名，也可能是仓库名（github 安装时），所以两个都比。
 */
export function isInstalled(plugin: CatalogPlugin, entries: Array<{ id: string; name: string }>): boolean {
  const wanted = new Set([plugin.packageName.toLowerCase(), plugin.repo.toLowerCase(), plugin.id.toLowerCase()]);
  return entries.some((entry) => wanted.has(String(entry.name || "").toLowerCase()) || wanted.has(String(entry.id || "").toLowerCase()));
}
