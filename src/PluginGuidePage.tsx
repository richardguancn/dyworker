import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Check,
  Copy,
  Layers,
  Palette,
  Radio,
  RefreshCw,
  Share2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { PLUGIN_COLOR_PRESETS, PLUGIN_ICON_PRESETS, PluginGlyph, pluginTileStyle } from "./lib/pluginIcons";
import "./styles/plugin-guide.css";

interface GuideStep {
  id: string;
  num: string;
  title: string;
  subtitle: string;
  heading: string;
  description: string;
  bullets: string[];
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "create",
    num: "01",
    title: "一句话做插件",
    subtitle: "创造模式直接落地可用界面",
    heading: "开启「创造模式」，像聊工作一样说出想法",
    description:
      "不用懂代码或技术名词。开启输入框下方的「创造模式」开关（或发 /create），说明你想做什么独立页面、看板或工具，助手会自动生成、校验并热挂载到左侧边栏或右侧工具栏。",
    bullets: [
      "说「做个独立页面接入飞书项目计划」会直接生成左侧原生独立页",
      "把上期 Excel/CSV 报表或截图拖进对话框，助手会按真实表头建模画图",
      "纯本地插件通过安全校验后自动安装打开，无需手动配环境",
    ],
  },
  {
    id: "customize",
    num: "02",
    title: "图标、配色与重命名",
    subtitle: "系统内置 36 款图标与作者编辑",
    heading: "随时换图标、改颜色、重命名与标注作者",
    description:
      "在「插件」列表点击插件图标或「外观与信息」，即可挑系统内置图标、切换主题配色、重命名展示名称并填写作者；左侧边栏、顶栏、右侧工具栏和插件页实时同步焕新。",
    bullets: [
      "36 个办公/看板/文档/连接类系统图标，支持关键词秒搜",
      "12 个深浅色自适应主题色 + 自定义取色器，卡片底色自动柔化",
      "不改动底层包名和数据路径，重命名安全无副作用，导出分享同步带走",
    ],
  },
  {
    id: "update",
    num: "03",
    title: "迭代改版升版本",
    subtitle: "创造模式更新并自动递增版本号",
    heading: "不满意随时改，改完自动升级版本号并热刷新",
    description:
      "做出来的插件想加筛选器、换图表或修样式？保持在「创造模式」直接提需求，助手会定位源码修改并自动递增语义化版本号（如 v0.1.0 → v0.1.1 / v0.2.0），热刷新界面。",
    bullets: [
      "自动保留你已经调整好的名称、作者、图标与配色",
      "每次更新自动升级 package.json 版本号并同步更新运行记录",
      "无需重启 DYWorker，页面原地秒级刷新出最新改版",
    ],
  },
  {
    id: "share",
    num: "04",
    title: "打包与局域网直传",
    subtitle: "单文件 .dyplugin 与同事一键互传",
    heading: "做好之后一键导出分享包，或局域网直发同事",
    description:
      "点击插件卡片上的「分享」，可导出单文件 .dyplugin（默认仅源码不含个人数据，可选勾选附带数据），也可直接扫描局域网里的在线 DYWorker 同事，对方点同意即可导入使用并继续二改。",
    bullets: [
      "分享时自动携带当前设置好的展示名、作者、图标和配色",
      "支持直接把 .dyplugin 或 .zip 拖进插件页预览并导入",
      "导入后源码自动进入受管目录，同事还能继续用创造模式定制",
    ],
  },
];

const SANDBOX_ICONS = PLUGIN_ICON_PRESETS.filter((item) =>
  ["layout-grid", "file-spreadsheet", "folder-kanban", "bar-chart-3", "clipboard-check", "globe", "sparkles"].includes(item.id),
);

const PROMPT_EXAMPLES = [
  {
    id: "feishu-page",
    title: "接入飞书/外部系统独立页面",
    tag: "左侧独立页",
    prompt: "开启创造模式：帮我做一个左侧独立页面，接入飞书项目计划表格，支持按阶段筛选、展示里程碑进度卡片，关闭软件后配置不丢。",
  },
  {
    id: "iterate-plugin",
    title: "给已有插件加功能并升级版本",
    tag: "迭代升级",
    prompt: "帮我更新「项目计划看板」插件：顶部新增按负责人筛选和状态分布柱状图，保留当前图标和名字，改完同步升级一个版本号。",
  },
  {
    id: "side-checklist",
    title: "对话框旁边的随手自查工具",
    tag: "右侧随手栏",
    prompt: "帮我在右侧工具栏做一个「公文与周报自查清单」小面板：支持逐条打勾、显示完成进度条，也能自己增删检查项。",
  },
  {
    id: "share-team",
    title: "打包分享给部门同事复用",
    tag: "团队分享",
    prompt: "帮我把刚才做好的看板插件打包导出为 .dyplugin 分享包，包含默认模板数据但先扫描排查一下敏感路径。",
  },
];

export function PluginGuidePage({
  onBack,
  onStartCreate,
}: {
  onBack: () => void;
  onStartCreate: () => void;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [copiedId, setCopiedId] = useState("");

  // 交互式沙盒状态（第 2 步可实时点击体验）
  const [sandboxName, setSandboxName] = useState("飞书项目计划台");
  const [sandboxAuthor, setSandboxAuthor] = useState("产品研发部");
  const [sandboxIcon, setSandboxIcon] = useState("file-spreadsheet");
  const [sandboxColor, setSandboxColor] = useState("#2563eb");

  // 第 3 步版本号滚动体验状态
  const [versionIndex, setVersionIndex] = useState(1);
  const versionStages = [
    { ver: "v0.1.0", desc: "初版上线 · 基础数据看板" },
    { ver: "v0.1.1", desc: "修订更新 · 优化表格筛选与布局" },
    { ver: "v0.2.0", desc: "功能升级 · 新增里程碑统计图" },
  ];

  useEffect(() => {
    if (!autoPlay) return;
    const timer = window.setInterval(() => {
      setActiveStepIndex((prev) => (prev + 1) % GUIDE_STEPS.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [autoPlay]);

  useEffect(() => {
    if (activeStepIndex !== 2) return;
    const timer = window.setInterval(() => {
      setVersionIndex((prev) => (prev + 1) % versionStages.length);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [activeStepIndex]);

  const activeStep = GUIDE_STEPS[activeStepIndex] || GUIDE_STEPS[0];

  const handleCopyPrompt = async (id: string, prompt: string) => {
    try {
      if (window.dyworker?.writeClipboardText) {
        await window.dyworker.writeClipboardText(prompt);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
      }
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === id ? "" : cur));
      }, 1800);
    } catch {}
  };

  return (
    <section className="plugins-page plugin-guide-page" aria-label="插件与创造模式使用指南">
      <div className="plugin-guide-topbar">
        <button type="button" className="plugins-text-button" onClick={onBack}>
          <ArrowLeft size={15} /> 返回插件列表
        </button>
        <button type="button" className="plugins-add-button" onClick={onStartCreate}>
          <Wand2 size={14} /> 立即创建插件
        </button>
      </div>

      {/* 动态极光 Hero 区 */}
      <header className="plugin-guide-hero">
        <div className="plugin-guide-aurora" aria-hidden="true" />
        <div className="plugin-guide-hero-copy">
          <span className="plugin-guide-pill">
            <Sparkles size={13} /> DYWorker 创造模式 · 插件工坊
          </span>
          <h1>说话之间，把想法变成你的专属工作台插件</h1>
          <p>
            开启创造模式后，AI 直接为你构建并热挂载原生独立页面、右侧小工具或助手技能；
            支持随时换图标配色、重命名与标注作者、改版自动升版本，还能局域网直传给同事。
          </p>
          <div className="plugin-guide-hero-actions">
            <button type="button" className="plugin-guide-cta" onClick={onStartCreate}>
              <Wand2 size={15} /> 开启创造模式做插件 <ArrowRight size={15} />
            </button>
            <button
              type="button"
              className="plugins-text-button"
              onClick={() => {
                setAutoPlay(false);
                setActiveStepIndex(1);
              }}
            >
              <Palette size={14} /> 试玩图标与配色定制
            </button>
          </div>
        </div>

        <div className="plugin-guide-hero-stage" aria-hidden="true">
          <div className="plugin-guide-float-card">
            <div className="plugin-guide-float-head">
              <div className="plugin-guide-float-icon" style={pluginTileStyle(sandboxColor, "hero-demo")}>
                <PluginGlyph iconId={sandboxIcon} color={sandboxColor} size={22} />
              </div>
              <div className="plugin-guide-float-meta">
                <strong>{sandboxName || "飞书项目计划台"}</strong>
                <span>作者：{sandboxAuthor || "产品研发部"} · 左侧独立页</span>
              </div>
              <span className="plugin-guide-ver-pill">{versionStages[versionIndex].ver}</span>
            </div>
            <div className="plugin-guide-float-bars">
              <div className="plugin-guide-bar-track"><div className="plugin-guide-bar-fill" /></div>
              <div className="plugin-guide-bar-track"><div className="plugin-guide-bar-fill" style={{ animationDelay: "0.9s" }} /></div>
            </div>
            <div className="plugin-guide-float-chips">
              <span>热挂载即开</span>
              <span>自定义图标</span>
              <span>自动升版本</span>
              <span>局域网分享</span>
            </div>
          </div>
        </div>
      </header>

      {/* 4 步交互演练舞台 */}
      <section className="plugin-guide-stage-section" aria-label="核心能力演练">
        <div className="plugin-guide-section-title">
          <h2>四大核心玩法</h2>
          <span>点击任意卡片切换体验 · {autoPlay ? "自动轮播中" : "已固定当前步骤"}</span>
        </div>

        <div className="plugin-guide-steps-nav" role="tablist" aria-label="插件能力步骤">
          {GUIDE_STEPS.map((step, index) => {
            const active = index === activeStepIndex;
            return (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`plugin-guide-step-tab ${active ? "active" : ""}`}
                onClick={() => {
                  setAutoPlay(false);
                  setActiveStepIndex(index);
                }}
              >
                <span className="plugin-guide-step-num">{step.num}</span>
                <strong>{step.title}</strong>
                <small>{step.subtitle}</small>
                {active && autoPlay && <span key={`${step.id}-prog`} className="plugin-guide-step-progress" />}
              </button>
            );
          })}
        </div>

        <div className="plugin-guide-stage-panel" key={activeStep.id} role="tabpanel">
          <div className="plugin-guide-stage-copy">
            <h3>{activeStep.heading}</h3>
            <p>{activeStep.description}</p>
            <ul className="plugin-guide-checklist">
              {activeStep.bullets.map((line) => (
                <li key={line}>
                  <Check size={14} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="plugin-guide-stage-visual">
            {activeStep.id === "create" && (
              <div className="guide-flow-nodes">
                <div className="guide-flow-node">
                  <span className="guide-flow-badge"><Blocks size={15} /></span>
                  <div>
                    <strong>1. 打开「创造模式」提需求</strong>
                    <small>“帮我做个左侧独立页面，接入飞书项目计划表格”</small>
                  </div>
                </div>
                <div className="guide-flow-node">
                  <span className="guide-flow-badge"><Layers size={15} /></span>
                  <div>
                    <strong>2. AI 自动构建原生插件并通过安全检查</strong>
                    <small>生成界面 + 数据接口，配好图标与配色</small>
                  </div>
                </div>
                <div className="guide-flow-node">
                  <span className="guide-flow-badge"><Sparkles size={15} /></span>
                  <div>
                    <strong>3. 左侧边栏即刻出现，点开就能用</strong>
                    <small>不产生零散 HTML 文件，后续可随时迭代</small>
                  </div>
                </div>
              </div>
            )}

            {activeStep.id === "customize" && (
              <div className="guide-sandbox-controls">
                <div className="guide-sandbox-inputs">
                  <input
                    type="text"
                    aria-label="体验重命名插件"
                    value={sandboxName}
                    maxLength={30}
                    onChange={(e) => setSandboxName(e.target.value)}
                    placeholder="输入插件名称"
                  />
                  <input
                    type="text"
                    aria-label="体验修改作者"
                    value={sandboxAuthor}
                    maxLength={24}
                    onChange={(e) => setSandboxAuthor(e.target.value)}
                    placeholder="输入作者名"
                  />
                </div>
                <div className="guide-sandbox-pickers">
                  <div className="guide-sandbox-icons" aria-label="试选系统图标">
                    {SANDBOX_ICONS.map((item) => {
                      const IconComp = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`guide-mini-icon-btn ${sandboxIcon === item.id ? "active" : ""}`}
                          title={item.label}
                          onClick={() => setSandboxIcon(item.id)}
                        >
                          <IconComp size={15} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="guide-sandbox-colors" aria-label="试选图标颜色">
                    {PLUGIN_COLOR_PRESETS.slice(0, 6).map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        className={`guide-mini-color-dot ${sandboxColor === c.hex ? "active" : ""}`}
                        style={{ background: c.hex }}
                        title={c.label}
                        onClick={() => setSandboxColor(c.hex)}
                      />
                    ))}
                  </div>
                </div>
                <div className="guide-sandbox-result">
                  <div
                    key={`${sandboxIcon}-${sandboxColor}`}
                    className="guide-sandbox-icon-pop"
                    style={pluginTileStyle(sandboxColor, "sandbox")}
                  >
                    <PluginGlyph iconId={sandboxIcon} color={sandboxColor} size={20} />
                  </div>
                  <div className="preview-card-meta">
                    <strong>{sandboxName.trim() || "我的插件"}</strong>
                    <span>{sandboxAuthor.trim() ? `作者：${sandboxAuthor.trim()}` : "未填写作者"} · 侧栏与插件页实时同步</span>
                  </div>
                </div>
              </div>
            )}

            {activeStep.id === "update" && (
              <div className="guide-version-timeline">
                {versionStages.map((stage, idx) => {
                  const current = idx === versionIndex;
                  return (
                    <div key={stage.ver} className={`guide-version-step ${current ? "active" : ""}`}>
                      <div>
                        <strong style={{ display: "block", fontSize: "calc(12.5px * var(--font-ui-scale, 1))" }}>{stage.desc}</strong>
                        <small style={{ color: "var(--muted)", fontSize: "calc(11.5px * var(--font-ui-scale, 1))" }}>
                          {current ? "正在热刷新界面并更新运行记录…" : "已归档版本状态"}
                        </small>
                      </div>
                      <span className="guide-version-badge">
                        {current && <RefreshCw size={11} className="spin" style={{ marginRight: 5 }} />}
                        {stage.ver}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {activeStep.id === "share" && (
              <div className="guide-radar-box">
                <div className="guide-radar-pulse" title="局域网自动发现">
                  <Radio size={24} />
                </div>
                <div className="guide-radar-beam" aria-hidden="true" />
                <div className="guide-radar-peer">
                  <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Share2 size={14} /> 同网段同事的 DYWorker
                  </strong>
                  <span>已打包：{sandboxName || "飞书项目计划台"} ({versionStages[versionIndex].ver})</span>
                  <small style={{ color: "var(--muted)", fontSize: "calc(11px * var(--font-ui-scale, 1))" }}>
                    携带图标配色与作者信息 · 对方同意即装
                  </small>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 大白话实战提示词模板 */}
      <section className="plugin-guide-stage-section" aria-label="推荐提示词模板">
        <div className="plugin-guide-section-title">
          <h2>直接抄作业：大白话提问示例</h2>
          <span>复制句子后去开启「创造模式」发送，或点「立即创建插件」</span>
        </div>

        <div className="plugin-guide-prompts-grid">
          {PROMPT_EXAMPLES.map((item) => {
            const copied = copiedId === item.id;
            return (
              <div className="plugin-guide-prompt-card" key={item.id}>
                <div>
                  <div className="plugin-guide-prompt-head">
                    <strong>{item.title}</strong>
                    <span className="plugin-tag">{item.tag}</span>
                  </div>
                  <blockquote style={{ marginTop: 10 }}>{item.prompt}</blockquote>
                </div>
                <div className="plugin-guide-prompt-actions">
                  <button
                    type="button"
                    className="plugins-text-button"
                    onClick={() => void handleCopyPrompt(item.id, item.prompt)}
                  >
                    {copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制话术</>}
                  </button>
                  <button type="button" className="plugins-add-button" onClick={onStartCreate}>
                    去创建
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </section>
  );
}
