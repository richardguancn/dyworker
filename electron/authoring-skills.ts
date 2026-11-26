/** 随应用分发的制作能力；不依赖用户额外安装技能或联网下载说明。 */
export type AuthoringKind = 'skill' | 'plugin';

// 这是可执行的最小工具插件，也用于检查制作指南是否与当前宿主兼容。
export const pluginStarterManifest = {
  name: 'dyworker-text-helper', version: '0.1.0', type: 'module', main: 'index.js',
  description: '整理文本中的多余空白',
  peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-alpha.1' },
};
export const pluginStarterSource = `import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'dyworker-text-helper';
export const inject = ['tools'];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'text_helper_clean',
    description: '整理文本中的多余空白，返回整理后的文本。',
    parameters: { text: { type: 'string', required: true, description: '需要整理的文本' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) { return { text: args.text.trim().replace(/\\s+/g, ' ') }; },
  }));
}
`;

export const authoringSkills = [
  {
    id: 'builtin-skill-creator', name: '技能制作',
    description: '根据需求创建、制作或改进 Skill 技能，把可重复的做法保存到技能列表，或制作带 SKILL.md 的技能目录。',
    instructions: `# 技能制作

用户要求创建、制作或改进技能时使用。先读已有相关技能，避免重复创建。用户已给出的用途、材料和限制无需重复询问；只询问影响正确性的缺项。

## 选择交付形式
默认制作 DYWorker 本地技能：名称、适用说明、完整执行要求。仅当用户需要跨应用复用、脚本、参考资料或资产时，制作当前工作区 .agents/skills/<英文短名称>/SKILL.md。不要把普通技能需求擅自改成安装插件。

## 制作要求
1. 从真实需求中提取触发场景、输入、产出、关键步骤、检查标准和失败时的处理。适用说明写清何时使用，不能只是“提高效率”。
2. 技能正文只保留能改变执行决策的具体要求，不堆叠通用建议。保留用户指定的工具、格式和边界。例子标为例子，未知事实不编造，不能把创建技能当作发送消息或发布内容的授权。
3. 以最少必要文件完成技能。只有确实需要重复执行的操作才加 scripts/，较长的资料放 references/，输出素材放 assets/。正文写明相对路径和使用条件，检查引用文件存在；不创建空目录或无用途的文件。
4. 文件技能的 SKILL.md 必须有 YAML 开头，至少包含 name 和 description；含特殊字符或换行的值使用正确引号或块文本。目录名使用小写英文、数字和短横线。正文说明目的、步骤和检查方法，不写入密钥和个人敏感资料。
5. 保存前拿一个有代表性的输入试用，再检查一个缺失输入或异常输入。包含脚本时实际运行脚本，检查输出；纯文字技能检查步骤是否自足、材料缺失时是否会误编信息。测试外部写入时使用模拟或隔离样本，不冒充真实业务已完成。
6. 本地技能用 save_skill 保存；用户明确要求改进现有本地技能时，用 update_skill 按编号更新。文件技能用文件工具创建或编辑，然后重新读取 SKILL.md 验证名称、说明、正文及引用文件。现有同名内容先读取，不直接覆盖。
7. 本地技能保存后用 list_skills 找到返回的编号，再用 load_skill 读回确认。文件技能保存后用 list_skills 检查当前工作区是否已识别；如列表未刷新，说明在“设置 → 技能”点“刷新技能”即可。
8. 简洁汇报创建位置、用途、做过的验证和使用方法：在输入框用 /技能名 引用。验证失败先修复再重试；无法完成的检查写明具体缺项，不把保存成功当作功能通过。`,
  },
  {
    id: 'builtin-plugin-creator', name: '插件制作',
    description: '根据需求创建、制作或改进 DYWorker 插件，生成可安装的本地插件目录，并检查入口、工具或界面功能。',
    instructions: `# 插件制作

先理解用户想解决的办公需求，再构建本地 DYWorker 插件。若仅是文字规范用技能，用户选插件或处于创造模式时直接制作插件。

## 1. 大白话需求理解与样本优先
- **面向用户零术语**：对话中不得要求用户懂插槽名、代码或 API；结尾只用白话说明入口在哪、怎么导入/使用。
- **样本驱动**：用户附上 Excel/CSV/文本样本或参考截图时，先读取字段与布局，直接按真实表头建模和生成解析逻辑。
- **低门槛澄清**：需求模糊时，编码前调 \`ask_user\` 问**至多 1 轮（2–3 个）日常选择题**（数据从哪来、放左侧整页还是右侧随手栏、手动导入还是每周自动更新），已明确的不再问。
- **意图映射**：
  - 独立看板/大屏/台账 → \`workspace.page\`；
  - 边聊边用清单/小工具 → \`sidebar.right.pane.tab\`；
  - 围绕当前对话跟踪视图 → \`conversation.view\`；
  - 留存历史/每周更新 → \`ctx.storage\` 持久化 + 页面导入按钮 + 注册 \`ctx.tools\` 工具（供定时任务/目录监控写入）；
  - 趋势/占比/统计图 → 前端 \`const echarts = require("echarts")\`（禁在 \`package.json\` 声明 \`echarts\` 依赖）。

## 2. 交付与目录
默认创建在 \`<userData>/created-plugins/<包名>/\`（仅用户指定时放工作区目录），不改内置插件。包名小写英文/数字/短横线；不声明 \`dyworker.builtin\` / \`dsh.builtin\`；仅本地运行，不发布外网。

## 3. 当前 DYWorker 的插件要求
插件为 Cordis ESM 模块，\`package.json\` 配 \`name/version/description/type:"module"/main:"index.js"\`；\`index.js\` 导出 \`name\`、\`inject\`（\`storage\`/\`connection\`/\`tools\`）、\`apply(ctx)\`。

### 工具插件（\`ctx.tools\`）
用 \`@deepseek-ai/dsh-tools\` 的 \`defineTool\` 调 \`ctx.tools.register(defineTool({...}))\`（带 \`parameters\`、\`output.schema\`、\`output.render\`、\`execute(args, exec)\`），遵循工作区路径与审批边界。

示例：
package.json：
\`\`\`json
${JSON.stringify(pluginStarterManifest, null, 2)}
\`\`\`
index.js：
\`\`\`js
${pluginStarterSource}
\`\`\`

### 界面插件（原生 \`dyworker.client\`，禁写 \`dsh\` 字段）
1. **\`package.json\`**：加 \`"exports": { ".": "./index.js", "./client": "./client.js" }\` 与 \`"dyworker": { "client": { "platform": "web", "inject": [] } }\`。
2. **\`index.js\`**：用 \`ctx.storage.readJson/writeJson\` 持久化，存储文件统一放到 \`<包名>/...\` 子目录（如 \`ctx.storage.readJson("<包名>/data.json")\`）以便分享时精准隔离数据；\`ctx.connection.register({ path: "/api/<包名>/...", methods: ["GET","POST"], fetch })\` 供前端 \`fetch("/api/...")\` 调用。
3. **\`client.js\`（classic script，禁 ESM \`import/export\` 与 JSX）**：
   - 使用 \`window.__ModuleLoader__.load({ id: "<包名>", factory(require) { ... } })\`，\`React.createElement\` 写界面，主题变量（\`var(--surface)\`/\`var(--card)\`/\`var(--border)\`/\`var(--ink)\`/\`var(--muted)\`）适配深浅色。
   - ECharts 用 \`const echarts = require("echarts");\`，在 \`useEffect\` 中 \`init\` + \`ResizeObserver\` + 清理 \`dispose()\`，\`backgroundColor: "transparent"\`。
   - 插槽在 \`apply(ctx)\` 注册：\`ctx.effect(() => ctx.slots.inject("<插槽>", () => ctx.slots.register({ key: "main", label: "标题" }, Comp)))\`：
\`\`\`js
window.__ModuleLoader__.load({
  id: "my-tool-page",
  factory(require) {
    const React = require("react");
    const e = React.createElement;
    return {
      name: "my-tool-page",
      inject: ["slots"],
      apply(ctx) {
        const Page = () => e("div", { style: { padding: 16, color: "var(--ink)" } }, "页面内容");
        ctx.effect(() => ctx.slots.inject("workspace.page", () => ctx.slots.register({ key: "main", label: "我的看板" }, Page)));
      }
    };
  }
});
\`\`\`

## 4. 验证与热挂载安装
1. 先调 \`plugin_inspect\`（\`action: "check"\`, \`target: "<目录>"\`）检查清单、安全与语法；
2. 通过后调 \`plugin_manage\`（\`action: "install"\`, \`target: "<目录>"\`, \`openSlot: true\` 或指定插槽）；在创造模式下受管目录的纯本地插件将自动安装并热挂载打开。若是工具插件，安装后须实际调用所注册工具核验返回结果；若是界面插件，确认插槽已挂载生效；
3. 二次修改后调 \`plugin_manage\`（\`action: "reload"\`）刷新；未实调或未通过须如实说明；
4. 用户明确要求“打包分享这个插件”时，可调 \`plugin_manage\`（\`action: "export"\`, \`target: "<包名或目录>"\`，默认 \`includeData: false\`；仅用户要求连带当前模板/数据一起分享时传 \`includeData: true\`）导出单文件 \`.dyplugin\` 分享包并告知完整文件位置。`,
  },
];

export function authoringSkill(kind: AuthoringKind) {
  return authoringSkills[kind === 'plugin' ? 1 : 0];
}
