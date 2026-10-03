// 插件 UI 接线契约：侧边栏入口位置、通道名两侧一致、面板真的接了桥。
//
// 渲染端是源码文本 + 人工验收；但"通道名两边不一致"这类问题只有真跑起来才会暴露
// （表现为点了没反应），所以这里用集合比对把它钉死在测试里。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const app = read("../src/App.tsx");
const panel = read("../src/PluginsPage.tsx");
const dialog = read("../src/AddPluginDialog.tsx");
const preload = read("../electron/preload.cjs");
const ipcPlugin = read("../electron/host/plugins/plugins-ipc.mts");

test("侧边栏入口：位于「新建任务」按钮正下方（用户指定的位置）", () => {
  const newTaskIndex = app.indexOf('className="new-task-button"');
  const pluginsIndex = app.indexOf("sidebar-plugins-button");
  assert.ok(newTaskIndex > 0, "应有「新建任务」按钮");
  assert.ok(pluginsIndex > 0, "应有「插件」入口");
  assert.ok(pluginsIndex > newTaskIndex, "「插件」入口必须在「新建任务」下方");
  // 两者之间不应插入其他按钮（位置贴合）
  const between = app.slice(newTaskIndex, pluginsIndex);
  assert.ok(!/className="[^"]*button/.test(between.replace(/className="new-task-button"/, "")), "两者之间不应夹其他按钮");
  assert.match(app, /<Sparkles size=\{17\} \/>\s*插件/, "入口文案与图标");
  assert.match(app, /setPluginsPageOpen\(\(open\) => !open\)/, "入口应切换插件页");
  assert.match(app, /className=\{`sidebar-plugins-button \$\{pluginsPageOpen \? "active" : ""\}`\}/, "当前在插件页时入口要高亮");
  assert.match(app, /\{pluginsPageOpen && <PluginsPage \/>\}/, "插件页应渲染在主内容区");
});

test("通道名两侧一致：preload 暴露的 plugins:* 与主进程注册的完全对应", () => {
  const exposed = new Set([...preload.matchAll(/invoke\("(plugins:[a-z-]+)"/g)].map((m) => m[1]));
  const registered = new Set([...ipcPlugin.matchAll(/ipc\.handle\("(plugins:[a-z-]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...exposed].sort(), [...registered].sort(), "preload 与主进程的插件通道必须一一对应");
  assert.ok(exposed.size >= 9, `至少 9 个通道，实际 ${exposed.size}`);
});

test("页面与弹窗各司其职：列表/启停在页面，安装与兼容性判定在「添加插件」弹窗", () => {
  for (const api of ["listPlugins", "enablePlugin", "disablePlugin", "configurePlugin", "uninstallPlugin", "reloadPlugins"]) {
    assert.match(panel, new RegExp(`bridge[?!]?\\.${api}\\b`), `插件页应调用 ${api}`);
  }
  for (const api of ["checkPluginCompatibility", "installPluginPackage"]) {
    assert.match(dialog, new RegExp(`bridge[?!]?\\.${api}\\b`), `添加弹窗应调用 ${api}`);
  }
  assert.match(dialog, /result\.matrix/, "安装失败时要能展示兼容矩阵");
  assert.match(dialog, /允许安装不完全兼容的插件/, "应提供显式放行开关");
  assert.match(panel, /plugin-row-error/, "条目失败原因要显示出来");
});

test("添加插件弹窗：支持 包名 / GitHub 地址 / 本地目录 三种来源", () => {
  assert.match(dialog, /输入插件的包名、GitHub 仓库地址或本地目录路径/, "副标题要说明三种来源");
  assert.match(dialog, /github\.com/, "占位/引导里要给出 GitHub 用法");
  assert.match(dialog, /本地目录/, "要提到本地目录");
  assert.match(dialog, /安装源/, "要有安装源选择");
  assert.match(dialog, /中国大陆镜像源/, "要提供大陆镜像源");
  assert.match(dialog, /registry\.npmmirror\.com/, "镜像源要写清 npm 走哪个源");
  assert.match(dialog, /代理会经手你拉取的代码/, "要诚实说明第三方代理经手代码");
  assert.match(dialog, /会执行该仓库的构建脚本/, "GitHub/本地来源要说明会跑构建脚本");
  assert.match(dialog, /插件安装引导和示例/, "要有可展开的引导");
  // 风险提示照抄 DSH 的口径
  assert.match(dialog, /请确认插件来源可信/);
  assert.match(dialog, /暂不支持自动更新/);
});

test("插件页是「页面」而不是「弹窗」：无遮罩层，渲染在主内容区内，切会话自动返回", () => {
  assert.ok(!panel.includes("plugins-overlay"), "不应再使用遮罩弹窗");
  assert.ok(!panel.includes("createPortal"), "不应挂在 portal 上");
  assert.match(app, /<main className=\{`main-panel \$\{pluginsPageOpen \? "plugins-page-open" : ""\}`\}>\s*\n\s*\{pluginsPageOpen && <PluginsPage \/>\}/, "插件页应直接渲染在 main-panel 内");
  assert.match(app, /useEffect\(\(\) => \{\s*\n\s*if \(!activeId\) return;\s*\n\s*setPluginsPageOpen\(false\);/, "切换会话时应回到聊天");
  // 版式：行式卡片 + 开关（对齐 DSH）
  assert.match(panel, /plugin-card-icon/, "行首应有图标块");
  assert.match(panel, /plugin-switch/, "行尾应有开关");
  assert.match(panel, /plugins-add-button/, "右上应有「添加插件」按钮");
});

test("类型定义：桥接与结果类型都在 types.ts 里声明", () => {
  const types = read("../src/types.ts");
  for (const name of ["PluginEntryRecord", "PluginBundleRecord", "PluginCompatibility", "PluginListResult", "PluginInstallResult"]) {
    assert.match(types, new RegExp(`export interface ${name}\\b`), `缺少类型 ${name}`);
  }
  assert.match(types, /listPlugins\(\): Promise<PluginListResult>/);
  assert.match(types, /installPluginPackage\(payload: \{ input\?: string; spec\?: string/, "安装入参要支持 input/source");
});

test("样式：入口、插件页与添加弹窗的样式都已定义", () => {
  const css = read("../src/styles.css");
  for (const selector of [".sidebar-plugins-button", ".plugins-page", ".plugins-compat", ".plugin-card",
    ".plugin-row-error", ".plugin-switch", ".add-plugin-dialog", ".add-plugin-warning", ".add-plugin-submit", ".plugins-text-button", ".add-plugin-mirror-note", ".add-plugin-build-note", ".install-result", ".install-result-card", ".install-result-mark"]) {
    assert.ok(css.includes(selector), `缺少样式 ${selector}`);
  }
});

test("样式覆盖：插件页用到的类名都在 styles.css 里定义（类名对不上是\"看着坏掉\"的常见原因）", () => {
  const css = read("../src/styles.css");
  const used = new Set();

  for (const source of [panel, dialog]) {
    // 静态 className="a b c"
    for (const match of source.matchAll(/className="([^"{]+)"/g)) {
      for (const token of match[1].split(/\s+/)) if (token) used.add(token);
    }
    // 模板串：只取 ${...} 之外的字面部分
    for (const match of source.matchAll(/className=\{`([^`]+)`\}/g)) {
      const literal = match[1].replace(/\$\{[^}]*\}/g, " ");
      for (const token of literal.split(/\s+/)) if (token) used.add(token);
    }
  }

  // 这些是全局通用类（由其它样式文件/组件提供），不要求在本文件里
  const shared = new Set(["spin", "muted", "bad", "ok", "warn", "on", "active", "danger"]);
  // 文字按钮必须是自有类：全局 .bare-button 是 20px 图标按钮，用于文字会被压成一条
  assert.ok(!/className="bare-button"/.test(read("../src/PluginsPage.tsx")), "插件页不应把图标按钮当文字按钮用");
  assert.ok(!/className="bare-button"/.test(read("../src/AddPluginDialog.tsx")), "添加弹窗不应把图标按钮当文字按钮用");
  const missing = [...used].filter((token) => !shared.has(token) && !css.includes(`.${token}`));
  assert.deepEqual(missing, [], `以下类名没有样式定义：${missing.join(", ")}`);
});

test("插件页打开时：会话列表不显示选中高亮，点会话（含当前选中）都能切回", () => {
  // 高亮要把插件页状态算进去：主内容区不是会话时，列表不该显示"当前选中"
  assert.match(app, /const selected = session\.id === activeId && !pluginsPageOpen;/,
    "会话高亮必须在插件页打开时失效");
  assert.match(app, /\$\{selected \? "active" : ""\}/, "高亮要改用 selected");
  // 点会话必须先关插件页：点"当前已选中"的会话时 activeId 不变，只靠 effect 关不掉
  assert.match(app, /const selectSession = \(session: SessionRecord\) => \{[\s\S]{0,400}?setPluginsPageOpen\(false\);/,
    "selectSession 必须先关闭插件页");
});

test("安装源：官方源 / 中国大陆镜像源 / 自定义地址 三选一，自定义带地址输入与说明", () => {
  assert.match(dialog, /官方源/);
  assert.match(dialog, /中国大陆镜像源/);
  assert.match(dialog, /自定义地址/);
  assert.match(dialog, /registry\.npmmirror\.com/, "镜像源要标出实际地址");
  assert.match(dialog, /placeholder="https:\/\/npm\.example\.com\/"/, "自定义地址要有输入框");
  assert.match(dialog, /需要登录的源，请把凭据放在本机的 ~\/\.npmrc 里/, "凭据指引要对齐 DSH 口径");
  assert.match(dialog, /customRegistry/, "自定义地址要传给主进程");
  assert.match(dialog, /role="radiogroup"/, "安装源是单选组");
});

test("安装结果界面：成功给「已安装 + 立即启用」，不兼容给原因与「仍然安装」", () => {
  assert.match(dialog, /install-result/, "要有结果视图");
  assert.match(dialog, /已安装/, "成功显示「已安装」");
  assert.match(dialog, /立即启用/, "成功要能一键启用");
  assert.match(dialog, /enablePlugin/, "「立即启用」要真的调启用接口");
  assert.match(dialog, /查看安装详情/, "要有详情展开");
  assert.match(dialog, /无法运行/, "不兼容时同款界面说明");
  assert.match(dialog, /仍然安装（仅主机半边，不会生效）/, "给出显式放行而不是死路");
  assert.match(dialog, /setResult\(\{[\s\S]{0,200}?ok: false/, "拒绝时进入结果视图");
});
