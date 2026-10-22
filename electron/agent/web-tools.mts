// 公开网页访问、搜索与结果解析。
import net from "node:net";
import { deepseekAnthropicBaseUrl,detectProvider,glmToolBaseUrl,qwenResponsesUrl,searchDeepseekNative,searchGlmNative,searchQwenNative } from "../providers.mts";


// ---- 网页工具：仅公开 HTTP/HTTPS，阻断本机与内网地址 ----
// 注意：本区块守卫服务 SSRF 敏感路径（web_search / fetch_web_page 等模型自主抓取）。
// 内嵌浏览器面板（用户手动输入 / browser__open 工具）按产品决策放行 localhost 与
// 内网地址，走下方的 isSafeBrowserUrl，两者不要混用。

// 内网/本机地址判断：new URL() 已把八进制、十六进制、整数等 IPv4 变体规范化为点分十进制，
// 这里按「IPv4 字面量 / IPv6 字面量（含方括号与 zone id）/ 域名」三类分别判断，
// 避免旧的裸前缀正则（fc|fd|fe80）误伤 fcxxx.com 这类正常域名。
function isPrivateIpv4(host) {
  const [a, b] = host.split(".").map(Number);
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6Literal(host) {
  const bare = host.split("%")[0];
  if (!bare.includes(":")) return false;
  // 以 "::" 开头涵盖环回（::1）、未指定（::）与 IPv4 映射/兼容形式（::ffff:7f00:1 等，均代表本机或内网 IPv4）
  if (bare.startsWith(":")) return true;
  const first = Number.parseInt(bare.split(":")[0], 16);
  if (!Number.isFinite(first)) return true; // 解析不了的 IPv6 形式按可疑处理
  return (first >= 0xfc00 && first <= 0xfdff) // ULA 私网 fc00::/7
    || (first >= 0xfe80 && first <= 0xfebf); // 链路本地 fe80::/10
}

function isPrivateHost(hostname) {
  let host = String(hostname || "").toLowerCase().trim();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.includes(":")) return isPrivateIpv6Literal(host);
  if (net.isIP(host) === 4) return isPrivateIpv4(host);
  // 域名：只拦本地域名后缀
  return /(^|\.)localhost$|\.local$/.test(host);
}

export function isSafePublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return { ok: false, error: "网址无效，只允许公开的 HTTP 或 HTTPS 网页" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "只允许访问公开的 HTTP 或 HTTPS 网页" };
  }
  if (url.username || url.password) return { ok: false, error: "网页地址不能包含账号或口令" };
  const host = url.hostname.toLowerCase();
  if (!host || isPrivateHost(host)) return { ok: false, error: "不允许访问本机或内部网络地址" };
  return { ok: true, url };
}

// 内嵌浏览器面板专用校验：与 isSafePublicUrl 的差别是不拦截 localhost/内网地址
// （产品决策：面板是用户可见可操作的浏览器，查看本地开发服务是正当需求；
// 模型经 browser__open 打开时用户也能全程看到）。仍限 http/https + 禁 userinfo。
// SSRF 敏感路径（fetch_web_page 等模型自主抓取）必须继续用 isSafePublicUrl。
export function isSafeBrowserUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return { ok: false, error: "网址无效，只允许 HTTP 或 HTTPS 网页" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "只允许访问 HTTP 或 HTTPS 网页" };
  }
  if (url.username || url.password) return { ok: false, error: "网页地址不能包含账号或口令" };
  if (!url.hostname) return { ok: false, error: "网址无效，只允许 HTTP 或 HTTPS 网页" };
  return { ok: true, url };
}

function decodeHtmlEntities(text) {
  const named = { nbsp: " ", ens: " ", emsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", ndash: "–", mdash: "—", hellip: "…", middot: "·" };
  return text
    .replace(/&(nbsp|ensp|emsp|amp|lt|gt|quot|#39|apos|ndash|mdash|hellip|middot);/gi, (match, entity) => named[entity.toLowerCase().replace(/^#/, "#")] ?? match)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const codepoint = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isFinite(codepoint) && codepoint <= 0x10ffff ? String.fromCodePoint(codepoint) : match;
    });
}

export function htmlToText(html, maxCharacters = 20000) {
  let source = String(html || "");
  source = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  source = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  source = source.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  source = source.replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(/<\/(?:p|div|section|article|header|footer|main|aside|h[1-6]|li|tr|table|ul|ol)>/gi, "\n");
  source = source.replace(/<li\b[^>]*>/gi, "- ");
  source = source.replace(/<[^>]+>/g, "");
  let text = decodeHtmlEntities(source);
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > maxCharacters) return `${text.slice(0, maxCharacters)}\n\n……网页内容较长，后续部分已省略`;
  return text;
}

export function parseSoResults(html, limit = 10) {
  const expression = /<h3[^>]*class=["'][^"']*res-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const lines = [];
  let match;
  while ((match = expression.exec(String(html || ""))) && lines.length < Math.min(Math.max(limit, 1), 20)) {
    const link = match[1];
    const title = htmlToText(match[2], 500).replace(/\n+/g, " ").trim();
    if (!title || !isSafePublicUrl(link).ok) continue;
    lines.push(`${lines.length + 1}. ${title}\n${link}`);
  }
  return lines.join("\n\n");
}

export function parseSogouResults(html, limit = 10) {
  const expression = /<h3[^>]*class=["'][^"']*vr-title[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const lines = [];
  let match;
  while ((match = expression.exec(String(html || ""))) && lines.length < Math.min(Math.max(limit, 1), 20)) {
    let link = match[1];
    if (link.startsWith("/")) link = `https://www.sogou.com${link}`;
    const title = htmlToText(match[2], 500).replace(/\n+/g, " ").trim();
    if (!title || !isSafePublicUrl(link).ok) continue;
    lines.push(`${lines.length + 1}. ${title}\n${link}`);
  }
  return lines.join("\n\n");
}

// 必应国内版：免费、无需密钥、结果带摘要，结构规整（li.b_algo → h2>a + .b_caption p）
export function parseBingResults(html, limit = 10) {
  const blocks = String(html || "").split(/<li[^>]*class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>/i).slice(1);
  const cap = Math.min(Math.max(limit, 1), 20);
  const lines = [];
  for (const block of blocks) {
    if (lines.length >= cap) break;
    const linkMatch = /<h2[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!linkMatch) continue;
    const link = linkMatch[1];
    const title = htmlToText(linkMatch[2], 500).replace(/\n+/g, " ").trim();
    if (!title || !isSafePublicUrl(link).ok) continue;
    const captionMatch = /<p[^>]*class=["'][^"']*b_lineclamp[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(block)
      || /<div[^>]*class=["'][^"']*b_caption[^"']*["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = captionMatch ? htmlToText(captionMatch[1], 500).replace(/\s+/g, " ").trim().slice(0, 200) : "";
    lines.push(`${lines.length + 1}. ${title}\n${link}${snippet ? `\n摘要：${snippet}` : ""}`);
  }
  return lines.join("\n\n");
}

// 开源方案：自建 SearXNG（JSON API）。这是用户显式配置的可信端点，不限制内网地址。
async function searchSearxng(fetchImpl, endpoint, query, limit = 10) {
  const base = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("SearXNG 地址为空");
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`SearXNG 返回错误（${response.status}）`);
  const result = await response.json();
  const items = (Array.isArray(result?.results) ? result.results : [])
    .filter((item) => item?.url && item?.title)
    .slice(0, Math.min(Math.max(limit, 1), 20));
  if (!items.length) return "没有找到搜索结果";
  return items.map((item, index) => {
    const snippet = String(item.content || "").replace(/\s+/g, " ").trim().slice(0, 160);
    return `${index + 1}. ${item.title}\n${item.url}${snippet ? `\n摘要：${snippet}` : ""}`;
  }).join("\n\n");
}

// 博查（Bocha）AI 搜索 API：结构化 JSON，带摘要和发布日期，不受网页反爬影响
export function parseBochaResults(payload, limit = 10) {
  const items = (payload?.data?.webPages?.value || [])
    .filter((item) => item?.url && item?.name)
    .slice(0, Math.min(Math.max(limit, 1), 20));
  if (!items.length) return "";
  return items.map((item, index) => {
    const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const date = String(item.datePublished || item.dateLastCrawled || "").slice(0, 10);
    return `${index + 1}. ${item.name}${date ? `（${date}）` : ""}\n${item.url}${snippet ? `\n摘要：${snippet}` : ""}`;
  }).join("\n\n");
}

async function searchBocha(fetchImpl, apiKey, query, limit = 10) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetchImpl("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, summary: true, count: Math.min(Math.max(limit, 1), 20) }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`博查搜索返回错误（${response.status}）`);
  const parsed = parseBochaResults(await response.json(), limit);
  if (!parsed) throw new Error("博查搜索没有找到结果");
  return parsed;
}

// 搜索优先级：DeepSeek 原生搜索 → Qwen 原生搜索 → 博查 API → 自建 SearXNG → 免费抓取（必应国内版（带摘要）→ 360 → 搜狗）。
// 原生搜索按模型厂商路由：DeepSeek 端点复用会话密钥（settings.apiKey），
// 其他端点用独立配置的 deepseekSearchApiKey；Qwen 云端端点（DashScope）与
// GLM 云端端点（智谱）同样复用会话密钥（Web Search API 按次计费）。
// 本地部署的 Qwen（vLLM 等）没有服务端搜索后端，detectProvider 返回 null，自动落到后面的后端。
// Kimi 开放平台端点下本地 web_search 已被公式 web_search 替代（见 runAgent 工具装配），走不到这里。
// domesticSearchOnly=true 时跳过必应（微软服务，敏感查询不宜出境），只用境内引擎。
export async function webSearch(fetchImpl, query, limit = 10, options = {} as any) {
  const trimmed = String(query || "").replace(/\s+/g, " ").trim();
  // 结果首行标注搜索来源，方便用户与模型分辨实际走的后端（Kimi 公式搜索不走这里）
  const withSource = (source, text) => `搜索来源：${source}\n\n${text}`;
  const formatItems = (items) => items.map((item, index) => {
    const snippet = String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 200);
    const date = String(item.publishedAt || "").slice(0, 10);
    const title = item.title || item.url;
    return `${index + 1}. ${title}${date ? `（${date}）` : ""}\n${item.url}${snippet ? `\n摘要：${snippet}` : ""}`;
  }).join("\n\n");
  const isDeepseekEndpoint = detectProvider(options.endpoint) === "deepseek";
  const deepseekKey = isDeepseekEndpoint
    ? String(options.apiKey || "").trim()
    : String(options.deepseekSearchApiKey || "").trim();
  if (deepseekKey) {
    try {
      const items = await searchDeepseekNative(fetchImpl, {
        baseUrl: isDeepseekEndpoint ? deepseekAnthropicBaseUrl(options.endpoint) : undefined,
        apiKey: deepseekKey,
        query: trimmed,
        maxResults: limit,
      });
      if (items.length) {
        return withSource("DeepSeek 联网搜索（服务端）", formatItems(items));
      }
    } catch {
      // DeepSeek 搜索不可用时回退下一级
    }
  }
  // Qwen 云端端点：Responses 内建 web_search（enable_search 的 ChatCompletions 协议不回搜索来源，不用）
  if (detectProvider(options.endpoint) === "qwen" && String(options.apiKey || "").trim()) {
    try {
      const { answer, items } = await searchQwenNative(fetchImpl, {
        baseUrl: qwenResponsesUrl(options.endpoint),
        apiKey: options.apiKey,
        model: options.model,
        query: trimmed,
        maxResults: limit,
      });
      if (items.length) {
        const summary = answer ? `综合答复：${answer.replace(/\s+/g, " ").trim().slice(0, 500)}\n\n` : "";
        return withSource("Qwen 联网搜索（服务端）", `${summary}${formatItems(items)}`);
      }
    } catch {
      // Qwen 搜索不可用时回退下一级
    }
  }
  // GLM 云端端点：智谱 Web Search API（独立工具接口，返回结构化结果，可溯源）
  if (detectProvider(options.endpoint) === "glm" && String(options.apiKey || "").trim()) {
    try {
      const items = await searchGlmNative(fetchImpl, {
        baseUrl: glmToolBaseUrl(options.endpoint),
        apiKey: options.apiKey,
        query: trimmed,
        maxResults: limit,
      });
      if (items.length) {
        return withSource("GLM 联网搜索（智谱服务端）", formatItems(items));
      }
    } catch {
      // GLM 搜索不可用时回退下一级
    }
  }
  const bochaKey = String(options.bochaApiKey || "").trim();
  const searxngEndpoint = String(options.searxngEndpoint || "").trim();
  if (bochaKey) {
    try {
      return withSource("博查 API", await searchBocha(fetchImpl, bochaKey, trimmed, limit));
    } catch {
      // 博查不可用时回退下一级
    }
  }
  if (searxngEndpoint) {
    try {
      return withSource("SearXNG（自建）", await searchSearxng(fetchImpl, searxngEndpoint, trimmed, limit));
    } catch {
      // 自建搜索不可用时回退到国内引擎
    }
  }
  const attempts = [
    ...(options.domesticSearchOnly ? [] : [{ url: `https://cn.bing.com/search?q=${encodeURIComponent(trimmed)}`, parse: parseBingResults, label: "必应国内版" }]),
    { url: `https://www.so.com/s?q=${encodeURIComponent(trimmed)}`, parse: parseSoResults, label: "360 搜索" },
    { url: `https://www.sogou.com/web?query=${encodeURIComponent(trimmed)}`, parse: parseSogouResults, label: "搜狗" },
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const { body } = await fetchPublicPage(fetchImpl, attempt.url, 3);
      const parsed = attempt.parse(body, limit);
      if (parsed.trim()) return withSource(`公开网页抓取（${attempt.label}）`, parsed);
    } catch (error: any) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return "没有找到搜索结果";
}

const govHostPattern = /(^|\.)gov\.cn$|(^|\.)gov$|(^|\.)mil\.cn$/i;

function stripHighlight(text) {
  return String(text || "").replace(/<\/?em>/g, "").trim();
}

// 中国政府网官方搜索接口（权威来源，直接返回文号/机关/日期/原文链接）
async function govSearchOfficial(fetchImpl, query, limit = 8) {
  const url = `https://sousuo.www.gov.cn/search-gov/data?t=zhengce&q=${encodeURIComponent(query)}&sort=score&sortType=1&searchfield=title&p=1&n=${Math.min(Math.max(limit, 1), 15)}`;
  const { body } = await fetchPublicPage(fetchImpl, url, 3);
  const result = JSON.parse(body);
  const catMap = result?.searchVO?.catMap || {};
  const items = [...(catMap.gongwen?.listVO || []), ...(catMap.otherfile?.listVO || [])]
    .filter((item) => item?.url && item?.title)
    .slice(0, limit);
  if (!items.length) return "";
  const lines = items.map((item, index) => {
    const meta = [item.pcode, item.puborg, item.pubtimeStr].filter(Boolean).join("，");
    const summary = stripHighlight(item.summary).slice(0, 120);
    return `${index + 1}. ${stripHighlight(item.title)}（${meta}）\n${item.url}${summary ? `\n摘要：${summary}` : ""}`;
  });
  return `以下结果来自中国政府网（gov.cn），引用前请用 fetch_web_page 打开原文核对文号、条款和时效：\n\n${lines.join("\n\n")}`;
}

// 政府官网权威来源搜索：先走中国政府网官方接口，失败时回退国内引擎 site:gov.cn 过滤
export async function govSearch(fetchImpl, query, limit = 8, options = {} as any) {
  const trimmed = String(query || "").replace(/\s+/g, " ").trim();
  try {
    const official = await govSearchOfficial(fetchImpl, trimmed, limit);
    if (official) return official;
  } catch {
    // 官方接口不可用时走引擎回退
  }
  const raw = await webSearch(fetchImpl, `${trimmed} site:gov.cn`, Math.max(limit * 2, 10), options);
  const entries = raw.split("\n\n").map((block) => block.trim()).filter(Boolean);
  const official = entries.filter((block) => {
    const url = block.split("\n").pop() || "";
    try {
      return govHostPattern.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });
  const chosen = (official.length ? official : entries).slice(0, limit);
  if (!chosen.length) return "政府官网没有搜到相关内容，可以换关键词再试，或改用网页搜索";
  const note = official.length
    ? "以下结果来自政府官方网站，引用前请用 fetch_web_page 打开原文核对文号、条款和时效："
    : "未直接命中政府官网，以下是最接近的结果；引用前务必用 fetch_web_page 打开原文核实来源是否权威：";
  return `${note}\n\n${chosen.join("\n\n")}`;
}

export async function fetchPublicPage(fetchImpl, rawUrl, redirects = 5) {
  let current = String(rawUrl);
  for (let hop = 0; hop <= redirects; hop++) {
    const check = isSafePublicUrl(current);
    if (!check.ok) throw new Error(check.error);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetchImpl(check.url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "DYWorker/0.1 (+local assistant)" },
      });
    } catch (error: any) {
      throw new Error(error?.name === "AbortError" ? "网页访问超时" : `网页访问失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`网页返回了没有目标的重定向（${response.status}）`);
      current = new URL(location, check.url).toString();
      continue;
    }
    if (!response.ok) throw new Error(`网页返回错误（${response.status}）`);
    const body = await response.text();
    return { url: check.url.toString(), body };
  }
  throw new Error("网页重定向次数过多");
}
