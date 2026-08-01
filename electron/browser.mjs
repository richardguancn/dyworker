// DYWorker 浏览器协作（ROADMAP：在用户明确授权后打开网页、填写表单、下载资料和保存截图）。
// 主进程持有，窗口用户可见，操作可审计；导航走 SSRF 守卫，每次导航后重检重定向目标。
import { BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isSafePublicUrl, isSafeRelativePath } from "./agent.mjs";

const PAGE_TEXT_LIMIT = 8000;
const SNAPSHOT_LIMIT = 60;

// 在页面里收集可交互元素并登记引用，返回紧凑清单（对齐 agent-browser 的 a11y 快照思路）
const SNAPSHOT_SCRIPT = `(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const nodes = [...document.querySelectorAll("a, button, input, textarea, select, [role='button'], [role='link'], summary")].filter(visible);
  window.__dyworkerRefs = nodes;
  const items = nodes.slice(0, ${SNAPSHOT_LIMIT}).map((el, index) => {
    const text = (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 50);
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type") || "";
    const href = el.href || "";
    return index + " [" + tag + (type ? ":" + type : "") + "] " + text + (href ? " → " + href : "");
  });
  return "页面：" + document.title + "\\n" + location.href + "\\n\\n可交互元素（用编号引用）：\\n" + (items.join("\\n") || "（没有可交互元素）") + (nodes.length > ${SNAPSHOT_LIMIT} ? "\\n…共 " + nodes.length + " 个，仅列前 " + ${SNAPSHOT_LIMIT} + " 个" : "");
})()`;

const CLICK_SCRIPT = (ref) => `(() => {
  const el = (window.__dyworkerRefs || [])[${ref}];
  if (!el) return "元素不存在或页面已变化，请重新获取页面快照";
  el.scrollIntoView({ block: "center" });
  el.click();
  return "已点击：" + (el.innerText || el.value || el.tagName).toString().replace(/\\s+/g, " ").trim().slice(0, 60);
})()`;

const TYPE_SCRIPT = (ref, text) => `(() => {
  const el = (window.__dyworkerRefs || [])[${ref}];
  if (!el) return "元素不存在或页面已变化，请重新获取页面快照";
  const value = ${JSON.stringify(text)};
  el.scrollIntoView({ block: "center" });
  el.focus();
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) descriptor.set.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return "已输入 " + value.length + " 个字符";
})()`;

const TEXT_SCRIPT = `(() => {
  const text = (document.body?.innerText || "").replace(/\\n{3,}/g, "\\n\\n").trim();
  return "页面：" + document.title + "\\n" + location.href + "\\n\\n" + (text.length > ${PAGE_TEXT_LIMIT} ? text.slice(0, ${PAGE_TEXT_LIMIT}) + "\\n……（内容过长，已截断）" : text || "（页面没有可读文字）");
})()`;

export class BrowserAgent {
  constructor() {
    this.win = null;
    this.workspacePath = "";
    this.downloads = [];
  }

  setWorkspace(workspacePath) {
    this.workspacePath = String(workspacePath || "");
    this.downloads = [];
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 1120,
      height: 780,
      title: "DYWorker 浏览器协作",
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    // 下载资料：保存到工作区“下载”文件夹，文件名冲突时由系统追加序号
    const browserSession = this.win.webContents.session;
    const webContentsId = this.win.webContents.id;
    const handleDownload = (_event, item, webContents) => {
      if (webContents?.id !== webContentsId) return;
      if (!this.workspacePath) return;
      const name = path.basename(item.getFilename() || "download");
      if (!isSafeRelativePath(name)) return;
      const target = path.join(this.workspacePath, "下载", name);
      item.setSavePath(target);
      item.once("done", (_e, state) => {
        if (state === "completed") this.downloads.push(`下载/${name}`);
      });
    };
    browserSession.on("will-download", handleDownload);
    this.win.on("closed", () => {
      browserSession.removeListener("will-download", handleDownload);
      this.win = null;
    });
    return this.win;
  }

  downloadNote() {
    if (!this.downloads.length) return "";
    const note = `\n已下载到工作区：${[...new Set(this.downloads)].join("、")}`;
    this.downloads = [];
    return note;
  }

  async evaluate(script) {
    if (!this.win || this.win.isDestroyed()) return { ok: false, result: "浏览器窗口还没有打开网页，请先用 browser__open 打开" };
    try {
      const value = await this.win.webContents.executeJavaScript(script, true);
      return { ok: true, result: String(value ?? "（没有返回内容）") + this.downloadNote() };
    } catch (error) {
      return { ok: false, result: `页面操作失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async open(rawUrl) {
    const check = isSafePublicUrl(rawUrl);
    if (!check.ok) return { ok: false, result: check.error };
    const win = this.ensureWindow();
    win.show();
    try {
      await win.webContents.loadURL(check.url.toString());
    } catch (error) {
      return { ok: false, result: `网页打开失败：${error instanceof Error ? error.message : String(error)}` };
    }
    // 重定向后的最终地址也要过守卫，防止跳到内网
    const finalUrl = win.webContents.getURL();
    if (finalUrl && finalUrl !== "about:blank") {
      const finalCheck = isSafePublicUrl(finalUrl);
      if (!finalCheck.ok) {
        await win.webContents.loadURL("about:blank").catch(() => {});
        return { ok: false, result: `网页重定向到了不允许的地址，已拦截：${finalUrl}` };
      }
    }
    return { ok: true, result: `已打开：${win.webContents.getTitle() || finalUrl}\n${finalUrl}${this.downloadNote()}` };
  }

  async screenshot(relativePath) {
    if (!this.win || this.win.isDestroyed()) return { ok: false, result: "浏览器窗口还没有打开网页" };
    const name = String(relativePath || "").trim() || `截图-${Date.now()}.png`;
    if (!isSafeRelativePath(name) || !this.workspacePath) return { ok: false, result: "截图只能保存到工作区内" };
    const target = path.resolve(this.workspacePath, name.endsWith(".png") ? name : `${name}.png`);
    if (!target.startsWith(path.resolve(this.workspacePath) + path.sep)) return { ok: false, result: "截图只能保存到工作区内" };
    try {
      const image = await this.win.webContents.capturePage();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, image.toPNG());
      return { ok: true, result: `截图已保存到工作区：${path.relative(this.workspacePath, target)}` };
    } catch (error) {
      return { ok: false, result: `截图失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async handle(name, args) {
    switch (name) {
      case "browser__open": return this.open(args?.url);
      case "browser__read": return this.evaluate(TEXT_SCRIPT);
      case "browser__snapshot": return this.evaluate(SNAPSHOT_SCRIPT);
      case "browser__click": return this.evaluate(CLICK_SCRIPT(Number(args?.ref) || 0));
      case "browser__type": return this.evaluate(TYPE_SCRIPT(Number(args?.ref) || 0, String(args?.text ?? "")));
      case "browser__screenshot": return this.screenshot(args?.path);
      case "browser__close":
        if (this.win && !this.win.isDestroyed()) this.win.close();
        this.win = null;
        return { ok: true, result: "浏览器窗口已关闭" };
      default:
        return { ok: false, result: `未知浏览器操作：${name}` };
    }
  }
}

export function browserToolDefinitions() {
  const stringArg = (description) => ({ type: "string", description });
  const tool = (name, description, properties, required) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  });
  return [
    tool("browser__open", "在可见的浏览器窗口中打开一个公开网页（用户可全程看到操作）。不得访问本机或内网地址。", { url: stringArg("公开 HTTP/HTTPS 网址") }, ["url"]),
    tool("browser__read", "读取当前网页的正文文字内容。", {}, []),
    tool("browser__snapshot", "列出当前网页的可交互元素（链接、按钮、输入框等）及编号，点击或输入前先获取。", {}, []),
    tool("browser__click", "点击网页中的一个元素（用 browser__snapshot 返回的编号）。", { ref: { type: "integer", description: "元素编号" } }, ["ref"]),
    tool("browser__type", "在网页输入框中填写文字（用 browser__snapshot 返回的编号）。", { ref: { type: "integer", description: "输入框编号" }, text: stringArg("要填写的文字") }, ["ref", "text"]),
    tool("browser__screenshot", "把当前网页截图保存到工作区，用于留存证据。", { path: stringArg("相对工作区的保存路径，以 .png 结尾") }, ["path"]),
    tool("browser__close", "关闭浏览器窗口，结束浏览器协作。", {}, []),
  ];
}
