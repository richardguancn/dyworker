import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, 'docs', 'copyright');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// -------------------------------------------------------------
// 1. 抽取 60 页源代码 (前后各 30 页，每页 50 行，共 3000 行)
// -------------------------------------------------------------

function cleanSourceCode(filePath) {
  const fullPath = path.join(projectRoot, filePath);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const cleaned = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    // 过滤完全空行、大块无关版权头等
    if (!trimmed) continue;
    if (trimmed.startsWith('//') && (trimmed.includes('eslint') || trimmed.includes('@ts-'))) continue;
    // 敏感过滤：避免暴露开发环境敏感信息
    if (trimmed.includes('sk-') || trimmed.includes('AKIA') || trimmed.includes('ghp_')) continue;
    cleaned.push(line);
  }
  return cleaned;
}

// 前 30 页（系统初始化、主架构、渲染主框架、Agent 调度入口）
const frontFiles = [
  'electron/main.mts',
  'electron/agent.mts',
  'electron/approval-context.mts',
  'src/main.tsx',
  'src/App.tsx',
  'src/app/ShellLayout.tsx',
  'src/state/sessionStore.ts',
  'src/state/taskActions.ts',
];

// 后 30 页（记忆系统、安全权限策略、命令防护执行、轨迹视图、桌面自动化管控）
const backFiles = [
  'electron/memory.mts',
  'electron/command-protection.mts',
  'electron/agent/permissions.mts',
  'electron/command-execution.mts',
  'electron/trace-writer.mts',
  'src/TraceView.tsx',
  'src/TraceConsole.tsx',
  'electron/skills.mts',
];

let frontLines = [];
for (const file of frontFiles) {
  frontLines.push(...cleanSourceCode(file));
  if (frontLines.length >= 1500) break;
}
frontLines = frontLines.slice(0, 1500);

let backLines = [];
for (const file of backFiles) {
  backLines.push(...cleanSourceCode(file));
  if (backLines.length >= 1500) break;
}
backLines = backLines.slice(0, 1500);

// 合并并分页（每页 50 行）
const allLines = [...frontLines, ...backLines];
const totalPages = 60;
const linesPerPage = 50;

let sourceDocText = '';
for (let page = 1; page <= totalPages; page++) {
  const startIdx = (page - 1) * linesPerPage;
  const pageLines = allLines.slice(startIdx, startIdx + linesPerPage);

  sourceDocText += `================================================================================\n`;
  sourceDocText += `DYWorker智能工作助手桌面软件 V1.0                                      源代码清单\n`;
  sourceDocText += `================================================================================\n\n`;

  for (let i = 0; i < pageLines.length; i++) {
    sourceDocText += `${pageLines[i]}\n`;
  }

  // 补齐到 50 行（如果有微小缺口）
  for (let i = pageLines.length; i < linesPerPage; i++) {
    sourceDocText += `// End of Section\n`;
  }

  sourceDocText += `\n--------------------------------------------------------------------------------\n`;
  sourceDocText += `第 ${page} 页 / 共 ${totalPages} 页\n`;
  sourceDocText += `================================================================================\n\n\n`;
}

const sourceOutputPath = path.join(outputDir, 'DYWorker智能工作助手桌面软件_源程序清单_60页.txt');
fs.writeFileSync(sourceOutputPath, sourceDocText, 'utf8');
console.log(`[成功] 已生成 60 页源程序清单：${sourceOutputPath}`);
