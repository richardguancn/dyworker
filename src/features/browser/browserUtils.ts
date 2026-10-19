export type BrowserDownloadRecord = {
  id: string;
  filename: string;
  path: string;
  received: number;
  total: number;
  state: "progressing" | "interrupted" | "completed" | "cancelled";
  startedAt: number;
};

export type BrowserPasswordEntry = { origin: string; username: string; source: string; importedAt: string };

export type BrowserWebviewElement = HTMLElement & {
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
  getURL?: () => string;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  isLoading?: () => boolean;
  getWebContentsId?: () => number;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  findInPage?: (text: string, options?: { forward?: boolean; findNext?: boolean }) => Promise<unknown>;
  stopFindInPage?: (action?: "clearSelection" | "keepSelection") => void;
  setZoomLevel?: (level: number) => void;
  capturePage?: () => Promise<{ toDataURL: () => string }>;
  print?: () => void;
  setUserAgent?: (userAgent: string) => void;
  getUserAgent?: () => string;
};

// 浏览器起始页的快捷链接（新标签页未打开网页时展示）；公开版不提供预设入口
export const BROWSER_START_LINKS: Array<{ name: string; url: string }> = [];

// 设备工具栏预设（设备模拟）
export const BROWSER_DEVICE_PRESETS = [
  { name: "手机", width: 390, height: 844 },
  { name: "平板", width: 820, height: 1180 },
];

// 浏览器标签页标题：网址去掉协议与路径只留主机名；页面加载完成后会被真实标题覆盖
export const browserTabTitleOf = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "新标签页";

export const BROWSER_MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// 往页面里填已保存的密码：密码框必填，用户名框取密码框之前最近的文本/邮箱输入
export const browserPasswordFillScript = (username: string, password: string) => `(() => {
  const pw = document.querySelector("input[type=password]");
  if (!pw) return "页面上没有密码输入框";
  const scope = pw.closest("form") || document;
  const fields = [...scope.querySelectorAll("input")];
  const pwIndex = fields.indexOf(pw);
  const user = [...fields.slice(0, pwIndex)].reverse().find((el) => ["text", "email", "tel", ""].includes(el.type)
    || /username|email|account|phone|user/i.test(el.name + " " + el.id + " " + el.autocomplete));
  const setVal = (el, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (user) setVal(user, ${JSON.stringify(username)});
  setVal(pw, ${JSON.stringify(password)});
  return user ? "已填充用户名和密码" : "已填充密码";
})()`;

// 浏览器品牌色（导入对话框的图标圆点）
export const BROWSER_BRAND_COLORS: Record<string, string> = {
  chrome: "#ea4335",
  edge: "#0c88c5",
  chromium: "#4d6fd1",
  brave: "#fb542b",
  browser360: "#3aa655",
  qaxbrowser: "#7b5cd6",
};

// 地址栏协议补全：localhost/内网地址默认 http（本地开发服务多无 TLS），其余默认 https。
// 单标签主机名（无点，如 nas:8080）公网不存在，按内网处理；裸 IPv6 补方括号。
export function normalizeBrowserInput(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  const hostEnd = raw.search(/[/?#]/);
  const head = hostEnd === -1 ? raw : raw.slice(0, hostEnd);
  const tail = hostEnd === -1 ? "" : raw.slice(hostEnd);
  const bracketed = head.startsWith("[");
  // 裸 IPv6（含 2 个以上冒号且无方括号）：整段都是主机名，没有端口可剥
  const bareIpv6 = !bracketed && (head.match(/:/g) || []).length > 1;
  const host = bracketed
    ? head.slice(1, head.indexOf("]")).toLowerCase()
    : bareIpv6
      ? head.toLowerCase()
      : head.toLowerCase().replace(/:\d+$/, "");
  // IPv6 环回/未指定/IPv4 映射以 ":" 开头；fe80::/10 链路本地与 fc00::/7 ULA 私网
  const ipv6Local = host.includes(":")
    && (host.startsWith(":") || /^(fe[89ab]|fc|fd)/.test(host));
  const isLocal =
    host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local")
    || ipv6Local
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
    || /^0\./.test(host)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    || (!host.includes(".") && !host.includes(":")); // 单标签主机名视为内网
  const normalized = bareIpv6 ? `[${head}]${tail}` : raw;
  return `${isLocal ? "http" : "https"}://${normalized}`;
}
