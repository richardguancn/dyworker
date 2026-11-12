import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const mdPath = path.join(projectRoot, 'docs', 'copyright', 'DYWorker智能工作助手桌面软件_用户使用说明书.md');
const htmlPath = path.join(projectRoot, 'docs', 'copyright', 'DYWorker智能工作助手桌面软件_用户使用说明书_预览与打印.html');

let mdContent = fs.readFileSync(mdPath, 'utf8');

// 将本地图片替换为 base64 内嵌，确保单文件 HTML 在任何地方打开都能正常显示图片
const imgRegex = /!\[(.*?)\]\((file:\/\/\/.*?\.(?:png|jpg|jpeg))\)/g;
mdContent = mdContent.replace(imgRegex, (match, alt, fullUrl) => {
  const filePath = fullUrl.replace('file://', '');
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).slice(1);
    const base64 = fs.readFileSync(filePath).toString('base64');
    return `<div class="img-wrapper"><img src="data:image/${ext};base64,${base64}" alt="${alt}" /><p class="caption">${alt}</p></div>`;
  }
  return match;
});

// 简单的 Markdown 转 HTML 解析 (标题、粗体、列表、分割线、段落)
let lines = mdContent.split('\n');
let htmlBody = '';
let inList = false;

for (let line of lines) {
  let trimmed = line.trim();

  if (trimmed.startsWith('# ')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `<h1>${trimmed.slice(2)}</h1>\n`;
  } else if (trimmed.startsWith('## ')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `<h2>${trimmed.slice(3)}</h2>\n`;
  } else if (trimmed.startsWith('### ')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `<h3>${trimmed.slice(4)}</h3>\n`;
  } else if (trimmed.startsWith('#### ')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `<h4>${trimmed.slice(5)}</h4>\n`;
  } else if (trimmed.startsWith('---')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `<hr/>\n`;
  } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    if (!inList) { htmlBody += '<ul>\n'; inList = true; }
    const content = trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    htmlBody += `  <li>${content}</li>\n`;
  } else if (/^\d+\.\s/.test(trimmed)) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    const content = trimmed.replace(/^\d+\.\s/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    htmlBody += `<p class="numbered"><strong>${trimmed.match(/^\d+\./)[0]}</strong> ${content}</p>\n`;
  } else if (trimmed.startsWith('<div class="img-wrapper">')) {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    htmlBody += `${trimmed}\n`;
  } else if (trimmed === '') {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
  } else {
    if (inList) { htmlBody += '</ul>\n'; inList = false; }
    const content = trimmed
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    htmlBody += `<p>${content}</p>\n`;
  }
}
if (inList) { htmlBody += '</ul>\n'; }

const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>DYWorker智能工作助手桌面软件 V1.0 用户使用说明书</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 20mm 20mm 20mm;
      @bottom-center {
        content: counter(page);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.68;
      color: #24292e;
      max-width: 900px;
      margin: 0 auto;
      padding: 30px;
      font-size: 14px;
    }
    h1 {
      font-size: 24px;
      text-align: center;
      margin-top: 30px;
      margin-bottom: 8px;
      color: #1a1a1a;
    }
    h2 {
      font-size: 18px;
      text-align: center;
      margin-top: 0;
      margin-bottom: 25px;
      font-weight: 500;
      color: #555;
    }
    h3 {
      font-size: 17px;
      border-bottom: 1px solid #eaecef;
      padding-bottom: 8px;
      margin-top: 30px;
      margin-bottom: 16px;
      color: #0366d6;
    }
    h4 {
      font-size: 15px;
      margin-top: 20px;
      margin-bottom: 12px;
      color: #24292e;
    }
    p, li {
      margin-top: 0;
      margin-bottom: 10px;
      text-align: justify;
    }
    ul {
      padding-left: 24px;
      margin-bottom: 12px;
    }
    li {
      margin-bottom: 6px;
    }
    hr {
      border: 0;
      border-top: 1px solid #ddd;
      margin: 20px 0;
    }
    code {
      background-color: #f6f8fa;
      padding: 2px 5px;
      border-radius: 3px;
      font-family: SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 12px;
    }
    .img-wrapper {
      text-align: center;
      margin: 20px 0;
      page-break-inside: avoid;
    }
    .img-wrapper img {
      max-width: 90%;
      border-radius: 6px;
      border: 1px solid #e1e4e8;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .caption {
      font-size: 12px;
      color: #6a737d;
      margin-top: 6px;
      font-style: italic;
    }
    @media print {
      body {
        max-width: 100%;
        padding: 0;
      }
      .img-wrapper img {
        max-width: 85%;
      }
      h3 {
        page-break-before: auto;
      }
    }
  </style>
</head>
<body>
  ${htmlBody}
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf8');
console.log(`[成功] 已生成可视化与打印专用 HTML：${htmlPath}`);
