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

用户明确要求制作 DYWorker 插件时使用。先确认想增加的实际能力，判断是否需要工具、界面或两者。仅可复用的文字流程优先建议技能，用户明确选插件时尊重选择。已明确的信息不重复询问。

## 交付与边界
需要一个工作文件夹；没有时请用户选择。新插件放在当前工作区 plugins/<包名>/，不要修改应用内置插件或用户已安装的插件目录。检查是否存在同名目录，存在时先读取并判断是改进还是另起名称。交付 package.json、可直接执行的 index.js、必要资源、验证脚本和 README.md。默认只制作本地内容，不发布到 npm、GitHub 或其他外部服务。

## 当前 DYWorker 的插件要求
插件是 Cordis 模块。主机入口必须显式导出 name、inject 和 apply(ctx)，inject 仅声明实际需要且宿主提供的服务。package.json 至少声明 name、version、description、type: "module" 和 main: "index.js"，包名用小写英文、数字和短横线。不要标记 dyworker.builtin，不要用 Claude 插件或普通 MCP 配置冒充 DYWorker 插件。

工具插件使用 @deepseek-ai/dsh-tools 的 defineTool，调用 ctx.tools.register(defineTool({...}))。参数字段采用此库的 type、required、description，不套用未经核对的其他工具格式。提供 output.schema 和 output.render；execute(args, exec) 返回结构化结果。需要任务状态时使用 exec.agent 所属会话，禁止跨任务共享状态；涉及文件操作时限定目标目录并检查路径，涉及外部写入时遵循当前审批与用户授权。

下列是可运行的文本工具示例，必须按用户需求更改包名、工具名和功能，不把示例功能当成完成用户需求：

package.json：
\`\`\`json
${JSON.stringify(pluginStarterManifest, null, 2)}
\`\`\`

index.js：
\`\`\`js
${pluginStarterSource}
\`\`\`

## 界面插件
只有用户需要界面才增加客户端。package.json 的 exports["./client"] 指向 client.js，dsh.client.platform 为 "web"。client.js 必须是经典脚本，调用 window.__ModuleLoader__.load({ id: 包名, factory(require) { ...; return 插件对象; } })；不要直接交付浏览器不能加载的 TSX、ESM import 或未打包源码。插件对象声明 name、inject、apply；使用已存在的界面服务与插槽。先读取当前环境可用的宿主示例或服务声明，再实现具体交互，不猜造服务、插槽和调用方法。无法核对所需界面服务时明确说明缺项，不声称已兼容。React 等已有宿主模块从 require 获取，避免重复打包导致冲突；数据图表优先使用 ECharts。

## 验证与安装
1. 读取并检查 package.json 的名称、入口、依赖与实际文件；运行语法检查和真实导入，确认 name、inject、apply 可用。测试只能模拟的部分需明确说明。
2. 工具插件用隔离的工具注册容器加载主机入口，实际调用所注册工具，验证代表性输入、空输入、异常输入，修复后重测。有文件操作时用临时目录；不要把依赖缺失或测试未运行写成通过。
3. 界面插件还需用真实模块加载器加载产物，确认不存在缺失模块，并打开页面检查渲染与交互。具备当前应用检查能力时再确认所需宿主服务；仅导入成功不能证明已安装可用。
4. README.md 写清用途、依赖、制作目录、实际验证结果和安装方法。用户可在“插件 → 安装本地插件”选择或填写完整目录，应用会检查兼容性，再启用插件。不要凭空编造 DYWorker CLI 命令；未授权安装或当前没有应用安装通道时，交付已验证目录并如实说明尚未安装。
5. 若用户同时要求安装，并且当前环境提供真实安装能力，按该能力安装，再确认插件列表中可见、状态正常和真实功能可调用；失败继续排查，无法完成时准确说明停在哪一步。不要仅凭制作成功宣称插件已启用。`,
  },
];

export function authoringSkill(kind: AuthoringKind) {
  return authoringSkills[kind === 'plugin' ? 1 : 0];
}
