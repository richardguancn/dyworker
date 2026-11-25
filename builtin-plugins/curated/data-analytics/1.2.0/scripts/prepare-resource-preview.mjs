#!/usr/bin/env node
// Local, content-only previews. No provider discovery or browser downloads.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const VERSION = "page-preview-2";
const MAX_IMAGE_LENGTH = 262144;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const escape = (value) => value.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const text = (value, field, limit) => {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value.slice(0, limit).replace(/\r\n?/gu, "\n");
};

// Deliberately a small display subset, not an HTML-capable Markdown renderer.
function inline(value) {
  return escape(value.replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1"))
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '<span class="link">$1</span>')
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/gu, "<em>$1</em>");
}

function openingContent(markdown, title) {
  const lines = markdown.trim().split("\n");
  const blocks = [];
  const cells = (line) => line.trim().replace(/^\||\|$/gu, "").split("|").slice(0, 4);
  for (let i = 0; i < lines.length && blocks.length < 12;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (/^```/u.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^```/u.test(lines[i]); i++) if (code.length < 5) code.push(lines[i]);
      i++;
      blocks.push(`<pre>${escape(code.join("\n"))}</pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      if (!(blocks.length === 0 && heading[2].trim().toLowerCase() === title.trim().toLowerCase())) {
        const level = Math.min(heading[1].length + 1, 3);
        blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      }
      i++; continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/u.test(lines[i + 1] ?? "")) {
      const header = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        if (rows.length < 4) rows.push(cells(lines[i]));
        i++;
      }
      blocks.push(`<table><thead><tr>${header.map(c => `<th>${inline(c.trim())}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${header.map((_, j) => `<td>${inline((row[j] ?? "").trim())}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^(?:[-*+] |\d+\. )/u.test(line)) {
      const ordered = /^\d/u.test(line), items = [];
      while (i < lines.length && /^(?:[-*+] |\d+\. )/u.test(lines[i].trim())) {
        if (items.length < 5) items.push(`<li>${inline(lines[i].trim().replace(/^(?:[-*+] |\d+\. )/u, ""))}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,6}\s|[-*+] |\d+\. |```)/u.test(lines[i].trim())) {
      if (lines[i].includes("|") && /^\s*\|?\s*:?-{3,}/u.test(lines[i + 1] ?? "")) break;
      paragraph.push(lines[i++].trim());
    }
    blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return blocks.join("\n");
}

function documentShell(body, css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Resource preview</title><style>${css}</style></head><body>${body}</body></html>`;
}

export function pagePreview(input) {
  if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("Expected Page metadata.");
  const uri = input.uri;
  if (typeof uri !== "string" || !uri || uri.length > 8192 || !URL.canParse(uri)) throw new Error("Page uri must be an absolute resource identity up to 8192 characters.");
  const title = text(input.title, "title", 500).trim();
  if (!title) throw new Error("Page title is required.");
  const markdown = text(input.markdown, "markdown", 12000);
  const preview = text(input.preview, "preview", 2000);
  const revision = text(input.revision, "revision", 500);
  const updated = text(input.updated_at, "updated_at", 100);
  const content = markdown.trim() || preview;
  // Match the 16:9 picker card. At 480px wide, body/title text is about 17/24px.
  // The host owns the hover label; content can continue beneath it and crop naturally.
  const html = documentShell(`<main><h1>${escape(title)}</h1><article>${openingContent(content, title)}</article></main>`, `
    *{box-sizing:border-box}html,body{margin:0;width:720px;height:405px;overflow:hidden;background:#fff;color:#202123}
    body{font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
    main{padding:34px 46px 0}
    h1{font-size:36px;line-height:43px;letter-spacing:-.7px;font-weight:700;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
    article{font-size:25px;line-height:34px;color:#414349;overflow-wrap:anywhere}
    h2,h3{color:#202123;font-size:27px;line-height:34px;margin:20px 0 10px;font-weight:700;letter-spacing:-.3px}
    p{margin:0 0 14px}ul,ol{padding-left:27px;margin:8px 0 14px}li{padding-left:3px;margin:4px 0}
    strong{font-weight:700;color:#27292d}.link{color:#2563a6}code{font-size:.88em;background:#f2f3f4;padding:2px 4px;border-radius:3px}
    pre{font-size:22px;line-height:30px;background:#f6f7f8;padding:14px;white-space:pre-wrap;overflow:hidden}
    table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:23px;line-height:30px;margin:14px 0}
    th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere}th{font-weight:700;background:#f8f9fa;color:#303238}
  `);
  return { uri, html, cacheKey: hash(JSON.stringify([VERSION, uri, title, markdown, preview, revision, updated])), width: 720, height: 405, kind: "page-content" };
}

export function iconPreview(svg) {
  if (typeof svg !== "string" || !/<svg[\s>]/u.test(svg) || Buffer.byteLength(svg) > 262144) throw new Error("Use an authentic SVG asset up to 256 KiB.");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return {
    html: documentShell(`<img alt="" src="${src}">`, "html,body{margin:0;width:64px;height:64px;background:transparent;overflow:hidden}img{display:block;width:64px;height:64px;object-fit:contain}"),
    cacheKey: hash(`${VERSION}:icon:${svg}`), width: 64, height: 64, kind: "icon",
  };
}

function imageResult(bytes, path, cached, spec) {
  const src = `data:image/png;base64,${bytes.toString("base64")}`;
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || src.length > MAX_IMAGE_LENGTH) throw new Error("Preview is not a supported PNG within the form image limit.");
  return { ...(spec.uri ? { uri: spec.uri } : {}), [spec.kind === "icon" ? "icon" : "thumbnail"]: { src, mimeType: "image/png" }, provenance: spec.kind, imagePath: path, cached };
}

export async function preparePreview(spec, { cacheDir, getBrowser }) {
  if (!isAbsolute(cacheDir)) throw new Error("Use an absolute task-owned cache directory.");
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  const path = join(cacheDir, `${spec.cacheKey}.png`);
  try { return imageResult(await readFile(path), path, true, spec); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: "block", offline: true });
  try {
    await context.route("**/*", route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent(spec.html, { waitUntil: "load", timeout: 5000 });
    const bytes = await page.screenshot({ type: "png", omitBackground: spec.kind === "icon", timeout: 5000 });
    const result = imageResult(bytes, path, false, spec);
    await writeFile(path, bytes, { mode: 0o600 });
    return result;
  } finally { await context.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: "string" }, icon: { type: "string" }, "cache-dir": { type: "string" },
    "browser-package-json": { type: "string" }, "browser-executable": { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("prepare-resource-preview.mjs --input <Page JSON> | --icon <official.svg> --cache-dir <absolute task directory> --browser-package-json <existing package.json> --browser-executable <installed Chromium>");
    return;
  }
  if (Boolean(values.input) === Boolean(values.icon) || !isAbsolute(values["cache-dir"] ?? "")) throw new Error("Specify --input or --icon, and an absolute --cache-dir.");
  const inputBytes = await readFile(values.input ?? values.icon);
  if (inputBytes.length > 1024 * 1024) throw new Error("Preview input exceeds 1 MiB.");
  const input = values.input ? JSON.parse(inputBytes.toString()) : null;
  const items = values.input ? (Array.isArray(input) ? input : [input]) : [];
  if (values.input && (!items.length || items.length > 24)) throw new Error("Use 1–24 Page candidates.");
  const specs = values.icon ? [iconPreview(inputBytes.toString())] : items.map(pagePreview);
  let browser;
  const getBrowser = async () => {
    if (!browser) {
      if (!isAbsolute(values["browser-package-json"] ?? "") || !isAbsolute(values["browser-executable"] ?? "")) throw new Error("No existing browser runtime supplied; omit the optional preview instead of installing dependencies.");
      const { chromium } = createRequire(values["browser-package-json"])("playwright-core");
      browser = await chromium.launch({ executablePath: values["browser-executable"], headless: true, timeout: 10000 });
    }
    return browser;
  };
  try {
    const options = { cacheDir: values["cache-dir"], getBrowser };
    const pageIcon = values.input
      ? await preparePreview(iconPreview(await readFile(new URL("../assets/page-resource-icon.svg", import.meta.url), "utf8")), options)
      : null;
    const results = [];
    for (const spec of specs) {
      const result = await preparePreview(spec, options);
      results.push(pageIcon ? { ...result, icons: [pageIcon.icon] } : result);
    }
    const output = join(values["cache-dir"], `${hash(specs.map(s => s.cacheKey).join(":"))}.json`);
    await writeFile(output, JSON.stringify(results), { mode: 0o600 });
    console.log(JSON.stringify({ output, images: results.map(({ imagePath, cached, provenance }) => ({ imagePath, cached, provenance })) }));
  } finally { await browser?.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
