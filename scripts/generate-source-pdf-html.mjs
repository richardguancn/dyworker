import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const srcTxtPath = path.join(projectRoot, 'docs', 'copyright', 'DYWorker智能工作助手桌面软件_源程序清单_60页.txt');
const srcHtmlPath = path.join(projectRoot, 'docs', 'copyright', 'DYWorker智能工作助手桌面软件_源程序清单_60页_打印.html');

const txtContent = fs.readFileSync(srcTxtPath, 'utf8');

// 按页分割
const rawPages = txtContent.split(/================================================================================\n第 \d+ 页 \/ 共 60 页\n================================================================================\n\n\n/);

let pagesHtml = '';

for (let i = 0; i < 60; i++) {
  const pageText = rawPages[i] || '';
  // 提取中间的代码行
  const lines = pageText.split('\n');
  // 过滤掉头部的大横线
  const codeLines = lines.filter(l => !l.startsWith('================') && !l.startsWith('----------------') && !l.includes('源代码清单'));

  const escapedCode = codeLines.join('\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  pagesHtml += `
  <div class="page">
    <div class="header">
      <span class="left">DYWorker智能工作助手桌面软件 V1.0</span>
      <span class="right">源程序清单</span>
    </div>
    <pre class="code"><code>${escapedCode}</code></pre>
    <div class="footer">
      第 ${i + 1} 页 / 共 60 页
    </div>
  </div>
  `;
}

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>DYWorker智能工作助手桌面软件 V1.0 源代码清单</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace;
      color: #111;
      background: #fff;
    }
    .page {
      width: 100%;
      height: 260mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
      padding: 5mm 0;
    }
    .header {
      border-bottom: 1px solid #333;
      padding-bottom: 5px;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      font-weight: 600;
    }
    .code {
      margin: 10px 0;
      font-size: 9.5px;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-all;
      flex-grow: 1;
      overflow: hidden;
    }
    .footer {
      border-top: 1px solid #999;
      padding-top: 5px;
      text-align: center;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
  </style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;

fs.writeFileSync(srcHtmlPath, fullHtml, 'utf8');
console.log(`[成功] 已生成源代码打印版 HTML：${srcHtmlPath}`);
