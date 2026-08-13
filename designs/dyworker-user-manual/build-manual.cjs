const fs = require('fs');
const path = require('path');

const ROOT = '/Users/gdy/Documents/My/App/dyworker';
const ASSETS = path.join(ROOT, 'designs/dyworker-user-manual/assets');
const OUT_DIR = path.join(ROOT, 'designs/dyworker-user-manual');
const OUT_FILE = path.join(OUT_DIR, 'DYWorker-用户操作手册.html');

// 手册章节定义：标题、导语、小节（含截图说明）
const chapters = [
  {
    id: 'overview',
    icon: '🏠',
    title: '产品概述与主界面',
    intro: 'DYWorker 是一款本地运行的 AI 工作助手：选一个文件夹作为工作区，用自然语言描述目标，助手会自己拆解步骤、逐步执行，所有数据留在本机。',
    sections: [
      {
        title: '1.1 主界面一览',
        image: '01-main-interface',
        caption: '主界面：左侧为任务列表与导航，右侧为当前任务的对话工作区',
        points: [
          '左侧边栏：任务列表（新建任务、切换历史任务）、工作区文件、记忆、技能、设置入口',
          '顶部：当前任务标题、工作区路径、模型状态',
          '对话区：与助手的多轮对话、执行计划、工具调用留痕',
          '输入框：输入自然语言指令，支持附件与图片（视觉模型开启时）',
        ],
      },
    ],
  },
  {
    id: 'workspace',
    icon: '📁',
    title: '工作区与任务对话',
    intro: '一切从工作区开始。助手只在你选定的文件夹里读写文件，任务历史、执行过程随时可追溯。',
    sections: [
      {
        title: '2.1 创建任务并对话',
        image: '02-task-conversation',
        caption: '任务对话：助手自动拆解步骤并排期执行，右侧可浏览工作区文件',
        points: [
          '在输入框描述目标，例如“把这三份会议纪要整理成一份周报 Word”',
          '助手会先给出执行计划，再逐步调用工具完成；每一步都有留痕',
          '右侧文件面板实时展示工作区内容，点击可直接预览',
          '任务支持暂停、继续、追问与追加要求',
        ],
      },
    ],
  },
  {
    id: 'office',
    icon: '📄',
    title: '办公文档读写与生成',
    intro: '文本、PDF、Word、Excel、PPT 都能读取；还能直接把 Word、Excel 生成到工作区，而不是只给你一段文字。',
    sections: [
      {
        title: '3.1 读取办公资料',
        image: '03-office-files',
        caption: '直接读取 PDF / Word / Excel / PPT 内容并参与分析与汇总',
        points: [
          '把文件放进工作区，直接说“总结一下这份 PDF 的要点”',
          '支持大文件分段读取，自动分页续读',
        ],
      },
      {
        title: '3.2 生成 Word 文档',
        image: '04-generated-word',
        caption: '按公文/报告格式生成真正的 .docx 文件，可直接用 WPS / Word 打开编辑',
        points: [
          '支持标题、正文、落款、附件说明等公文要素',
          '内置 GB/T 9704 公文格式检查工具',
        ],
      },
      {
        title: '3.3 生成 Excel 表格',
        image: '05-generated-excel',
        caption: '统计表、登记表、名单等结构化数据直接导出 .xlsx',
        points: [
          '多工作表、表头、数字单元格类型自动处理',
        ],
      },
      {
        title: '3.4 对话内可视化',
        image: '06-visualization',
        caption: '回答中嵌入图表、对比条、步骤条等可视化组件，辅助决策',
        points: [
          '数据对比、选项比较、流程步骤一目了然',
        ],
      },
    ],
  },
  {
    id: 'memory',
    icon: '🧠',
    title: '长期记忆与工作模板',
    intro: '告诉它一次“我们单位的公文格式要求”，它就记住了。常用任务还能沉淀为工作模板，一键复用。',
    sections: [
      {
        title: '4.1 记忆体系',
        image: '07-memory',
        caption: '记忆分为偏好、规则、禁忌、事实、经验五类，可全局通用或仅属于某个工作区',
        points: [
          '对话中自动识别并保存长期偏好/规则，也可在“记忆”面板手动管理',
          '工作区级记忆只影响当前项目，全局记忆跨项目生效',
        ],
      },
      {
        title: '4.2 技能包（Skills）',
        image: '08-skills',
        caption: '设置 → 技能库：搜索、安装 SkillHub 技能包，扩展专项能力',
        points: [
          '首次使用按 SkillHub 安装说明安装 CLI，安装后技能自动出现在列表',
          '工作模板：把重复流程保存为模板，下次直接复用',
        ],
      },
    ],
  },
  {
    id: 'models',
    icon: '🔌',
    title: '模型接入配置',
    intro: '兼容 OpenAI Chat Completions 与 Responses API，内置 DeepSeek V4 Flash / Pro，支持多套配置自由切换。',
    sections: [
      {
        title: '5.1 添加与切换模型',
        image: '09-model-config',
        caption: '设置 → 模型：多套模型配置，密钥经系统安全存储加密保存',
        points: [
          '支持 DeepSeek、通义、智谱及单位内网自建服务，填地址和密钥即可',
          '密钥绝不明文落盘，通过系统安全存储（Keychain / Credential Manager）保存',
          '图片理解：填写兼容视觉服务地址后，可处理图片输入',
        ],
      },
    ],
  },
  {
    id: 'channels',
    icon: '💬',
    title: 'QQ / 微信消息渠道',
    intro: '不在电脑前也能远程派活、收结果：手机 QQ / 微信发消息即可驱动助手。',
    sections: [
      {
        title: '6.1 配置 QQ 机器人',
        image: '10-qq-config',
        caption: '设置 → 渠道：填写 QQ 官方机器人的 AppID / Secret 完成接入',
        points: [
          '使用 QQ 官方机器人开放平台创建应用并获取凭据',
        ],
      },
      {
        title: '6.2 启用消息渠道',
        image: '11-qq-channel',
        caption: '渠道列表中启用 QQ 机器人，状态实时可见',
        points: [],
      },
      {
        title: '6.3 手机远程对话与派任务',
        image: '12-qq-chat',
        caption: '手机 QQ 直接对话：问进度、问结果',
        points: [],
      },
      {
        title: '6.4 手机远程派发任务',
        image: '13-qq-task',
        caption: '手机 QQ 远程派发任务，完成后结果推送到手机',
        points: [
          '任务在工作区内执行，产物文件保存在本机工作区',
        ],
      },
    ],
  },
  {
    id: 'local-control',
    icon: '🖥️',
    title: '本机操作与国产化支持',
    intro: 'AI 从“动口”变成“动手”：可操作 macOS / Linux 桌面应用；原生支持麒麟 V10 与 UOS。',
    sections: [
      {
        title: '7.1 操作本机应用',
        image: '14-control-pc',
        caption: '激活窗口、点击、输入文字：自动操作本机办公软件',
        points: [
          '首次使用可一键“检查并安装本机操控环境”，缺组件自动补装（安装前请求系统授权）',
          'macOS 需在系统设置中授予辅助功能与屏幕录制权限',
        ],
      },
      {
        title: '7.2 浏览器联动',
        image: '15-browser-open',
        caption: '在用户可见的浏览器面板中打开网页、读取内容、点击、填表、截图',
        points: [
          '仅访问公开网页，不访问本机或内网地址',
        ],
      },
    ],
  },
  {
    id: 'security',
    icon: '🛡️',
    title: '安全与审计',
    intro: '全程可审计，关键操作必确认；数据只留在本机。',
    sections: [
      {
        title: '8.1 风险操作确认',
        image: '16-risk-approval',
        caption: '风险命令与本机界面修改会先弹窗确认，单次操作单次授权',
        points: [
          '工作区外路径显示完整位置，逐次授权',
          '文件、命令、联网、外部工具调用全部留痕可查',
          '密钥、登录凭据、任务数据只保存在本机用户数据目录',
        ],
      },
    ],
  },
  {
    id: 'schedule',
    icon: '⏰',
    title: '计划任务与自动续跑',
    intro: '长任务不用守着：支持定时唤醒（1 分钟到 12 小时），任务中断后自动续跑。',
    sections: [
      {
        title: '9.1 定时与续跑',
        image: null,
        caption: null,
        points: [
          '对助手说“每小时检查一下××进度”即可创建定时唤醒',
          '应用重启后到点仍会唤醒；任务中断自动从断点续跑',
        ],
      },
    ],
  },
];

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function imgTag(name, alt) {
  const p = path.join(ASSETS, name + '.b64');
  if (!fs.existsSync(p)) {
    console.error('MISSING B64:', p);
    process.exitCode = 1;
    return '';
  }
  const b64 = fs.readFileSync(p, 'utf8').trim();
  if (!b64.startsWith('iVBOR')) {
    console.error('BAD B64 HEADER:', p);
    process.exitCode = 1;
  }
  return `<figure class="shot">
    <img src="data:image/png;base64,${b64}" alt="${esc(alt)}" loading="lazy" />
    <figcaption>${esc(alt)}</figcaption>
  </figure>`;
}

let sectionNo = 0;
const tocItems = [];
const bodyParts = [];

for (const ch of chapters) {
  tocItems.push(`<li><a href="#${ch.id}"><span class="toc-icon">${ch.icon}</span>${esc(ch.title)}</a></li>`);
  const sectionsHtml = ch.sections
    .map((sec) => {
      sectionNo += 1;
      const pts = sec.points && sec.points.length
        ? `<ul class="points">${sec.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
        : '';
      const img = sec.image ? imgTag(sec.image, sec.caption || sec.title) : '';
      return `<section class="manual-section" id="${ch.id}-${sectionNo}">
        <h3>${esc(sec.title)}</h3>
        ${img}
        ${pts}
      </section>`;
    })
    .join('\n');
  bodyParts.push(`<div class="chapter" id="${ch.id}">
    <div class="chapter-head">
      <div class="chapter-icon">${ch.icon}</div>
      <div>
        <h2>${esc(ch.title)}</h2>
        <p class="chapter-intro">${esc(ch.intro)}</p>
      </div>
    </div>
    ${sectionsHtml}
  </div>`);
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DYWorker 用户操作手册</title>
<style>
  :root {
    --bg: #f5f6fa;
    --panel: #ffffff;
    --ink: #1f2430;
    --ink-2: #5b6474;
    --brand: #3a6df0;
    --brand-soft: #eef3ff;
    --line: #e5e8f0;
    --radius: 14px;
    --shadow: 0 6px 24px rgba(30, 41, 82, .08);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--ink);
    line-height: 1.75;
  }
  .hero {
    background: linear-gradient(135deg, #2b4acb 0%, #3a6df0 55%, #5b8cff 100%);
    color: #fff;
    padding: 64px 24px 72px;
    text-align: center;
  }
  .hero h1 { margin: 0 0 12px; font-size: 34px; letter-spacing: .5px; }
  .hero p { margin: 0 auto; max-width: 720px; opacity: .92; font-size: 15px; }
  .hero .badge {
    display: inline-block; margin-bottom: 14px; padding: 4px 14px;
    border: 1px solid rgba(255,255,255,.45); border-radius: 999px; font-size: 12.5px; opacity: .95;
  }
  .layout {
    max-width: 1180px; margin: -40px auto 60px; padding: 0 20px;
    display: grid; grid-template-columns: 250px 1fr; gap: 24px; align-items: start;
  }
  nav.toc {
    position: sticky; top: 20px;
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: 18px 14px;
  }
  nav.toc h4 { margin: 0 0 10px 8px; font-size: 13px; color: var(--ink-2); font-weight: 600; letter-spacing: 1px; }
  nav.toc ul { list-style: none; margin: 0; padding: 0; }
  nav.toc a {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 9px; color: var(--ink);
    text-decoration: none; font-size: 13.5px;
  }
  nav.toc a:hover { background: var(--brand-soft); color: var(--brand); }
  .toc-icon { width: 20px; text-align: center; }
  main { min-width: 0; }
  .chapter {
    background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: 30px 34px; margin-bottom: 26px;
  }
  .chapter-head { display: flex; gap: 16px; align-items: flex-start; border-bottom: 1px solid var(--line); padding-bottom: 18px; margin-bottom: 8px; }
  .chapter-icon {
    flex: none; width: 46px; height: 46px; border-radius: 12px; font-size: 22px;
    background: var(--brand-soft); display: flex; align-items: center; justify-content: center;
  }
  .chapter h2 { margin: 2px 0 6px; font-size: 21px; }
  .chapter-intro { margin: 0; color: var(--ink-2); font-size: 14px; }
  .manual-section { padding: 18px 0 6px; }
  .manual-section h3 { font-size: 16.5px; margin: 6px 0 14px; padding-left: 12px; border-left: 3px solid var(--brand); }
  figure.shot {
    margin: 0 0 14px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
    background: #fafbfe;
  }
  figure.shot img { display: block; width: 100%; height: auto; }
  figure.shot figcaption {
    padding: 10px 14px; font-size: 13px; color: var(--ink-2);
    border-top: 1px solid var(--line); background: #fff;
  }
  ul.points { margin: 4px 0 10px; padding-left: 0; list-style: none; }
  ul.points li {
    position: relative; padding: 6px 0 6px 26px; font-size: 14.5px; color: #333a47;
  }
  ul.points li::before {
    content: ""; position: absolute; left: 6px; top: 15px; width: 7px; height: 7px;
    border-radius: 50%; background: var(--brand);
  }
  .callout {
    background: var(--brand-soft); border: 1px solid #d7e2ff; border-radius: 12px;
    padding: 14px 18px; font-size: 14px; color: #2c4a9e; margin: 0 0 26px;
  }
  footer { text-align: center; color: var(--ink-2); font-size: 12.5px; padding: 10px 0 40px; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    nav.toc { position: static; }
    .chapter { padding: 22px 18px; }
  }
  @media print {
    nav.toc { display: none; }
    .layout { grid-template-columns: 1fr; margin: 0; }
    body { background: #fff; }
    .chapter { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
  <header class="hero">
    <div class="badge">DYWorker · 本地 AI 工作助手</div>
    <h1>DYWorker 用户操作手册</h1>
    <p>选一个文件夹作为工作区，用自然语言描述目标，助手自动拆解步骤、逐步执行：读资料、写文档、做表格、操作办公软件，关键操作先确认，所有数据留在本机。</p>
  </header>
  <div class="layout">
    <nav class="toc">
      <h4>目录</h4>
      <ul>${tocItems.join('\n        ')}</ul>
    </nav>
    <main>
      <div class="callout">💡 <strong>快速上手</strong>：首次启动选择身份（通用 / 政府单位）→ 打开“设置”填入模型服务地址、模型名称与密钥 → 选择工作区文件夹 → 在输入框描述你的任务即可开始。</div>
      ${bodyParts.join('\n      ')}
    </main>
  </div>
  <footer>DYWorker 用户操作手册 · 基于当前版本界面整理 · 截图均为实际界面</footer>
</body>
</html>`;

fs.writeFileSync(OUT_FILE, html, 'utf8');
const sizeMB = (fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2);
console.log('WROTE:', OUT_FILE);
console.log('SIZE :', sizeMB, 'MB');
console.log('IMGS :', (html.match(/data:image\/png;base64,/g) || []).length);
