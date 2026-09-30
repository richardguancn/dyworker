// DYWorker 浏览器页面适配层：负责与具体的 webContents 进行协议级交互
// 包括：CDP 调试通道、A11y/DOM 紧凑快照、页面真实截图、坐标映射、双代次（导航/视口）失效、原生输入合成、iframe/ShadowDOM 穿透、正文读取与口令脱敏
import { promises as fs } from "node:fs";
import path from "node:path";

const PAGE_TEXT_LIMIT = 8000;
const SNAPSHOT_MAX_ELEMENTS = 120;

/**
 * 将截图坐标系中的像素点 (imageX, imageY) 准确转换为网页 CSS 坐标系
 * 换算规则：cssX = imageX * (cssWidth / imageWidth) + cropX
 */
export function mapImageCoordinateToCss(point, viewport) {
  if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
    throw new Error("无效的坐标输入：必须包含数值类型的 x 和 y");
  }
  if (!viewport || !viewport.imageWidth || !viewport.imageHeight || !viewport.cssWidth || !viewport.cssHeight) {
    throw new Error("无效的视口信息：无法换算坐标");
  }

  const scaleX = viewport.cssWidth / viewport.imageWidth;
  const scaleY = viewport.cssHeight / viewport.imageHeight;

  const cropX = Number(viewport.cropX) || 0;
  const cropY = Number(viewport.cropY) || 0;

  const cssX = Math.round(point.x * scaleX + cropX);
  const cssY = Math.round(point.y * scaleY + cropY);

  return { x: cssX, y: cssY };
}

/**
 * 页面语义与控件提取脚本：
 * 1. 穿透同源 iframe 与开放 Shadow DOM
 * 2. 识别 contenteditable 区域
 * 3. 严格禁止读取密码框（password）的真实 value，从采集源头彻底杜绝口令泄露
 */
const buildExtractScript = (obsId) => `((obsId) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  };

  const isPassword = (el) => {
    const type = (el.getAttribute("type") || el.type || "").toLowerCase();
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    return type === "password" || autocomplete.includes("password");
  };

  const interactiveSelector = "a[href], button, input, textarea, select, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='menuitem'], [role='tab'], summary, [contenteditable='true'], [tabindex='0'], iframe";

  const allFoundNodes = [];

  function scanContainer(root, framePrefix = "", parentOffsetX = 0, parentOffsetY = 0) {
    if (!root) return;
    try {
      const candidates = Array.from(root.querySelectorAll(interactiveSelector));
      for (const el of candidates) {
        if (!visible(el)) continue;

        // 如果是 iframe
        if (el.tagName.toLowerCase() === "iframe") {
          let hasAccess = false;
          try {
            if (el.contentDocument && el.contentDocument.body) {
              hasAccess = true;
              const iframeRect = el.getBoundingClientRect();
              const iframeStyle = window.getComputedStyle(el);
              const borderLeft = parseFloat(iframeStyle.borderLeftWidth) || 0;
              const borderTop = parseFloat(iframeStyle.borderTopWidth) || 0;
              const paddingLeft = parseFloat(iframeStyle.paddingLeft) || 0;
              const paddingTop = parseFloat(iframeStyle.paddingTop) || 0;
              const curX = parentOffsetX + iframeRect.x + borderLeft + paddingLeft;
              const curY = parentOffsetY + iframeRect.y + borderTop + paddingTop;
              scanContainer(el.contentDocument, (framePrefix ? framePrefix + " > " : "") + "iframe", curX, curY);
            }
          } catch (e) {
            hasAccess = false;
          }
          if (!hasAccess) {
            allFoundNodes.push({
              node: el,
              frame: framePrefix || "main",
              isCrossDomainIframe: true,
              src: el.src || "",
              offsetX: parentOffsetX,
              offsetY: parentOffsetY
            });
          }
          continue;
        }

        allFoundNodes.push({
          node: el,
          frame: framePrefix || "main",
          isCrossDomainIframe: false,
          offsetX: parentOffsetX,
          offsetY: parentOffsetY
        });

        // 检查当前元素自带的开放 Shadow DOM
        if (el.shadowRoot) {
          scanContainer(el.shadowRoot, (framePrefix ? framePrefix + " > " : "") + "shadow", parentOffsetX, parentOffsetY);
        }
      }

      // 穿透扫描所有容器级开放 Shadow DOM 宿主（如 Web Components 或普通 div 宿主）
      try {
        const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT, null);
        let curr = walker.nextNode();
        while (curr) {
          if (curr.shadowRoot && !curr.matches(interactiveSelector)) {
            scanContainer(curr.shadowRoot, (framePrefix ? framePrefix + " > " : "") + "shadow", parentOffsetX, parentOffsetY);
          }
          curr = walker.nextNode();
        }
      } catch (walkerErr) {}
    } catch (e) {
      // 忽略单个节点访问异常
    }
  }

  scanContainer(document, "", 0, 0);

  const items = allFoundNodes.slice(0, ${SNAPSHOT_MAX_ELEMENTS}).map((item, index) => {
    const el = item.node;
    el.setAttribute("data-dyworker-obs", obsId);
    el.setAttribute("data-dyworker-ref", String(index));
    try {
      el.__dyworker_node_stamp = obsId + ":" + index;
    } catch (e) {}
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || el.type || "").toLowerCase();
    const role = el.getAttribute("role") || tag;
    const isPw = isPassword(el);
    const isEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";

    // 严密防御：如果是密码输入框，绝对禁止读取 el.value！
    let name = "";
    if (isPw) {
      name = el.getAttribute("aria-label") || el.placeholder || el.getAttribute("title") || "密码输入框";
    } else if (item.isCrossDomainIframe) {
      name = "跨域内嵌页面 (" + (item.src || "未知来源") + ")";
    } else if (isEditable) {
      name = (el.innerText || el.textContent || "富文本编辑区").replace(/\\s+/g, " ").trim().slice(0, 60);
    } else {
      name = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.placeholder ||
        el.value ||
        el.getAttribute("title") ||
        ""
      ).replace(/\\s+/g, " ").trim().slice(0, 80);
    }

    const href = el.href || "";
    const enabled = !el.disabled && el.getAttribute("aria-disabled") !== "true";
    const checked = Boolean(el.checked || el.getAttribute("aria-checked") === "true");

    return {
      ref: index,
      tag,
      type: isPw ? "password" : type,
      role,
      name,
      href,
      enabled,
      checked,
      frame: item.frame,
      isContentEditable: isEditable,
      isCrossDomainIframe: item.isCrossDomainIframe,
      rect: {
        x: Math.round(rect.x + (item.offsetX || 0)),
        y: Math.round(rect.y + (item.offsetY || 0)),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  });

  return {
    title: document.title || "",
    url: location.href,
    totalCount: allFoundNodes.length,
    elements: items,
    viewport: {
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    }
  };
})(${JSON.stringify(obsId)})`;

/**
 * 构造下拉框选择的页内执行脚本（支持同源 iframe 与开放 Shadow DOM 穿透）。
 * 身份核验原则 (C3_replaced_select_wrong_peer)：
 * - 目标节点在事件响应中被替换或脱离文档时，保守判定目标失效；
 * - 严禁回退到“页面第一个下拉框”、可访问名称或碰巧同值的其他控件来确认成功。
 */
export function buildSelectScript({ observationId, ref, value, label } = {} as any) {
  const obsId = String(observationId || "");
  const refStr = String(ref);
  const targetVal = String(value ?? "");
  const targetLbl = String(label ?? "");
  const expectedStamp = obsId + ":" + refStr;

  return `(async () => {
      function findTargetDeep(root, obsId, refStr) {
        if (!root) return null;
        const selector = '[data-dyworker-obs="' + obsId + '"][data-dyworker-ref="' + refStr + '"]';
        try {
          const direct = root.querySelector(selector);
          if (direct) return direct;
        } catch (e) {}

        try {
          const iframes = Array.from(root.querySelectorAll("iframe"));
          for (const iframe of iframes) {
            try {
              if (iframe.contentDocument && iframe.contentDocument.body) {
                const found = findTargetDeep(iframe.contentDocument, obsId, refStr);
                if (found) return found;
              }
            } catch (e) {}
          }
        } catch (e) {}

        try {
          const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT, null);
          let curr = walker.nextNode();
          while (curr) {
            if (curr.shadowRoot) {
              const found = findTargetDeep(curr.shadowRoot, obsId, refStr);
              if (found) return found;
            }
            curr = walker.nextNode();
          }
        } catch (e) {}

        return null;
      }

      const el = findTargetDeep(document, ${JSON.stringify(obsId)}, ${JSON.stringify(refStr)});
      if (!el || el.tagName.toLowerCase() !== "select") {
        return { ok: false, error: "未找到目标元素或目标不是 select 元素" };
      }

      const expectedStamp = ${JSON.stringify(expectedStamp)};
      if (el.__dyworker_node_stamp !== expectedStamp) {
        return { ok: false, error: "目标选择框身份已发生变化" };
      }

      const targetVal = ${JSON.stringify(targetVal)};
      const targetLbl = ${JSON.stringify(targetLbl)};
      let matched = false;
      let selectedOption = null;

      for (const opt of el.options) {
        if (targetVal && opt.value === targetVal) {
          opt.selected = true;
          matched = true;
          selectedOption = opt;
          break;
        }
        if (targetLbl && opt.text.trim() === targetLbl.trim()) {
          opt.selected = true;
          matched = true;
          selectedOption = opt;
          break;
        }
      }

      if (!matched) {
        return { ok: false, error: "未匹配到指定选项：" + (targetVal || targetLbl) };
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));

      // 等待当前事件轮次、微任务及可能排队的页面更新处理完毕 (B3_microtask_select_reject)
      await new Promise(r => setTimeout(r, 20));

      // 关键核验：检查事件处理后页面是否接受了新选项值 (B3_replaced_select_reject / F8_select_actual_value_verified)
      const expectedValue = selectedOption.value;

      // 原节点在事件响应中被替换或脱离文档 (replaceWith / cloneNode) 时，
      // 无法证明文档中任何其他节点是同一目标，必须保守判定目标失效；
      // 严禁借用页面第一个下拉框或碰巧同值/同名的无关控件确认成功 (C3_replaced_select_wrong_peer)
      if (!el.isConnected) {
        return {
          ok: false,
          error: "目标下拉框在选项变更后被页面替换或移除，无法确认选择结果"
        };
      }

      if (el.value !== expectedValue) {
        return {
          ok: false,
          error: "选项变更被页面逻辑拒绝或重置（期望值: " + expectedValue + "，实际生效值: " + el.value + "）"
        };
      }

      return {
        ok: true,
        value: el.value,
        text: el.selectedOptions?.[0]?.text || el.value
      };
    })()`;
}

export class BrowserPageAdapter {
  contents;
debuggerAttached;
currentObservation;
observationHistory;
lastInputState;
documentEpoch;
viewportEpoch;
currentLeaseChecker;
constructor(contents) {
    this.contents = contents;
    this.debuggerAttached = false;
    this.currentObservation = null;
    this.observationHistory = new Map();
    this.lastInputState = { mouseDown: false, lastKey: null };

    // 双代次机制：导航代次与视口代次
    this.documentEpoch = 1;
    this.viewportEpoch = 1;
    this.currentLeaseChecker = null;

    this.bindNavigationListeners();
  }

  setLeaseChecker(checker) {
    this.currentLeaseChecker = typeof checker === "function" ? checker : null;
  }

  isDestroyed() {
    return !this.contents || this.contents.isDestroyed?.() || false;
  }

  bindNavigationListeners() {
    if (!this.contents || typeof this.contents.on !== "function") return;

    const onNavigated = () => {
      this.documentEpoch += 1;
      // 页面导航后，旧 observation 必须立即硬失效，彻底杜绝盲点错页 (F3)
      this.currentObservation = null;
    };

    this.contents.on("did-start-navigation", onNavigated);
    this.contents.on("did-navigate", onNavigated);
    this.contents.on("did-navigate-in-page", onNavigated);
    this.contents.on("did-frame-finish-load", onNavigated);
  }

  invalidateViewport() {
    this.viewportEpoch += 1;
    this.currentObservation = null;
  }

  /**
   * 确保 CDP 调试会话已挂载
   */
  async ensureDebugger() {
    if (this.isDestroyed()) throw new Error("TARGET_DESTROYED: 目标页面已销毁");
    try {
      if (!this.contents?.debugger) return false;

      if (!this.contents.debugger.isAttached()) {
        try {
          this.contents.debugger.attach("1.3");
          this.debuggerAttached = true;
          this.contents.debugger.on("detach", (_event, reason) => {
            this.debuggerAttached = false;
          });
        } catch (err: any) {
          this.debuggerAttached = false;
          return false;
        }
      } else {
        this.debuggerAttached = true;
      }
      return true;
    } catch {
      this.debuggerAttached = false;
      return false;
    }
  }

  /**
   * 发送 CDP 命令
   */
  async sendCDP(method, params = {} as any, { signal, checkLease } = {} as any) {
    await this.ensureDebugger();

    // 关键拦截点 (F1_protocol_await_boundary)：
    // 在 await ensureDebugger 返回后、在真正派发任何 CDP 命令之前的原子检查点！
    if (this.currentLeaseChecker && this.currentLeaseChecker() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管，CDP 发送被拦截");
    }
    if (checkLease && checkLease() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管，CDP 发送被拦截");
    }
    if (signal?.aborted) {
      throw new Error("LEASE_REVOKED: 动作已中止");
    }

    if (!this.debuggerAttached || !this.contents.debugger?.sendCommand) {
      throw new Error("CDP_UNAVAILABLE: 调试协议不可用");
    }
    return this.contents.debugger.sendCommand(method, params);
  }

  /**
   * 发送安全复位命令（仅允许 mouseReleased 和 keyUp，跳过常规 lease 拦截，确保接管或中断时无按键悬挂）
   */
  async sendCDPCleanup(method, params = {} as any) {
    const isSafeRelease =
      (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") ||
      (method === "Input.dispatchKeyEvent" && params.type === "keyUp");
    if (!isSafeRelease) return;
    if (this.isDestroyed() || !this.debuggerAttached) return;
    try {
      if (!this.contents?.debugger?.sendCommand) return;
      await this.contents.debugger.sendCommand(method, params);
    } catch {
      // 忽略清理释放异常
    }
  }

  /**
   * 读取页面正文内容（完整恢复 browser__read 能力，修复 F6）
   */
  async readPageText({ maxChars = PAGE_TEXT_LIMIT } = {} as any) {
    if (this.isDestroyed()) throw new Error("TARGET_UNAVAILABLE: 浏览器页面不可用");

    const script = `(() => {
      const clone = document.body ? document.body.cloneNode(true) : null;
      if (!clone) return "（页面没有正文内容）";
      // 移除脚本、样式、密码框以防敏感泄露
      const unwanted = clone.querySelectorAll("script, style, noscript, input[type='password']");
      unwanted.forEach((el) => el.remove());
      const text = (clone.innerText || clone.textContent || "").replace(/\\n{3,}/g, "\\n\\n").trim();
      return text || "（页面没有可读文字）";
    })()`;

    try {
      const text = await this.contents.executeJavaScript(script, true);
      const title = this.contents.getTitle?.() || "";
      const url = this.contents.getURL?.() || "";
      const truncated = text.length > maxChars;
      const content = truncated ? text.slice(0, maxChars) + "\n……（内容过长已截断）" : text;
      return {
        ok: true,
        title,
        url,
        result: `页面：${title}\n网址：${url}\n\n${content}`
      };
    } catch (err: any) {
      return { ok: false, result: `读取页面正文失败: ${err.message}` };
    }
  }

  /**
   * 观察当前页面：获取视口、语义树、截图
   */
  async observe({ mode = "auto", captureScreenshot = true, workspacePath = "" } = {} as any) {
    if (this.isDestroyed()) throw new Error("TARGET_UNAVAILABLE: 浏览器页面不可用");

    const observationId = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. 提取语义元素与视口元信息并为元素写入本次观察特有的 observationId 印章
    let snapshot;
    try {
      snapshot = await this.contents.executeJavaScript(buildExtractScript(observationId), true);
    } catch (err: any) {
      throw new Error(`OBSERVE_FAILED: 提取页面信息失败: ${err.message}`);
    }

    const url = snapshot.url || this.contents.getURL?.() || "";
    const title = snapshot.title || this.contents.getTitle?.() || "";

    // 2. 截图
    let images = [];
    let imageWidth = snapshot.viewport.cssWidth;
    let imageHeight = snapshot.viewport.cssHeight;

    if (captureScreenshot && typeof this.contents.capturePage === "function") {
      try {
        const nativeImg = await this.contents.capturePage();
        if (!nativeImg.isEmpty()) {
          const imgSize = nativeImg.getSize();
          imageWidth = imgSize.width;
          imageHeight = imgSize.height;
          const pngBuffer = nativeImg.toPNG();
          images = [{
            mimeType: "image/png",
            data: pngBuffer.toString("base64")
          }];

          if (workspacePath) {
            try {
              const debugFilePath = path.join(workspacePath, "下载", `.browser-${observationId}.png`);
              await fs.mkdir(path.dirname(debugFilePath), { recursive: true });
              await fs.writeFile(debugFilePath, pngBuffer);
            } catch {
              // 忽略留存写入错误
            }
          }
        }
      } catch (screenshotErr: any) {
        // 忽略截图错误
      }
    }

    const viewport = {
      ...snapshot.viewport,
      imageWidth,
      imageHeight,
      cropX: 0,
      cropY: 0
    };

    // 3. 构建供模型阅读的语义概括：明确第一行包含【观察编号】，并做好密码脱敏
    const elementLines = snapshot.elements.map((el) => {
      const typeStr = el.type ? `:${el.type}` : "";
      const stateStr = el.checked ? " [已选中]" : !el.enabled ? " [禁用]" : "";
      const hrefStr = el.href ? ` → ${el.href}` : "";
      const frameStr = el.frame && el.frame !== "main" ? ` [${el.frame}]` : "";
      return `${el.ref} [${el.tag}${typeStr}] ${el.name}${stateStr}${frameStr}${hrefStr} (${el.rect.x}, ${el.rect.y}, ${el.rect.width}×${el.rect.height})`;
    });

    const truncated = snapshot.totalCount > snapshot.elements.length;
    // 关键：【观察编号】置于首行，使模型能明确获取并必须在后续动作中回传 (F7)
    const textSummary = [
      `【观察编号】：${observationId}`,
      `页面标题：${title}`,
      `网址：${url}`,
      `视口尺寸：${viewport.cssWidth}×${viewport.cssHeight} (DPR: ${viewport.devicePixelRatio})`,
      `\n可操作元素列表（通过编号 ref 调用）：`,
      elementLines.length ? elementLines.join("\n") : "（没有检测到可见交互元素）",
      truncated ? `\n...还有 ${snapshot.totalCount - snapshot.elements.length} 个元素已省略` : ""
    ].filter(Boolean).join("\n");

    const observationData = {
      observationId,
      documentEpoch: this.documentEpoch,
      viewportEpoch: this.viewportEpoch,
      url,
      title,
      viewport,
      elements: snapshot.elements,
      capturedAt: Date.now(),
      summary: textSummary,
      images
    };

    this.currentObservation = observationData;
    this.observationHistory.set(observationId, observationData);
    if (this.observationHistory.size > 20) {
      const oldestKey = this.observationHistory.keys().next().value;
      this.observationHistory.delete(oldestKey);
    }

    return observationData;
  }

  /**
   * 严格核查 observationId 有效性（双代次与导航一致性校验，修复 F3）
   */
  validateObservation(observationId) {
    if (!observationId || typeof observationId !== "string") {
      return { ok: false, error: "STALE_OBSERVATION: 动作未包含有效的 observationId，请先获取最新观察" };
    }
    if (!this.currentObservation || this.currentObservation.observationId !== observationId) {
      return { ok: false, error: "STALE_OBSERVATION: 当前页面已更新或已有新观察，请基于最新观察操作" };
    }
    // 核查导航代次与视口代次
    if (this.currentObservation.documentEpoch !== this.documentEpoch) {
      return { ok: false, error: "STALE_OBSERVATION: 页面已发生导航或刷新，原观察已失效，请重新观察" };
    }
    if (this.currentObservation.viewportEpoch !== this.viewportEpoch) {
      return { ok: false, error: "STALE_OBSERVATION: 页面视口或缩放已变化，原观察已失效，请重新观察" };
    }
    // 核对当前实际 URL 与观察时是否一致
    const currentUrl = this.contents.getURL?.() || "";
    if (currentUrl !== this.currentObservation.url) {
      return { ok: false, error: `STALE_NAVIGATION: 页面已离开原观察网址（当前: ${currentUrl}），请重新观察` };
    }
    return { ok: true, observation: this.currentObservation };
  }

  /**
   * 动作前对目标节点进行实时深度身份与遮挡核验（修复 F3）
   */
  async verifyTargetElement(ref, obs) {
    const expected = obs.elements.find((el) => el.ref === ref);
    if (!expected) {
      throw new Error(`TARGET_NOT_FOUND: 找不到编号为 ${ref} 的目标元素`);
    }

    const script = `(() => {
      // 1. 视口尺寸与缩放核验：拖拽面板宽度或缩放改变后硬失效 (F3 / 补充要求 3)
      if (window.innerWidth !== ${obs.viewport.cssWidth} || window.innerHeight !== ${obs.viewport.cssHeight}) {
        return { ok: false, reason: "VIEWPORT_CHANGED" };
      }

      // 深度递归穿透查找目标元素：支持 document、开放 Shadow DOM 与同源 iframe (修复 F8_action_子页按钮 / 影子按钮)
      function findTargetDeep(root, obsId, ref, offsetX = 0, offsetY = 0) {
        if (!root) return null;
        try {
          const direct = root.querySelector('[data-dyworker-obs="' + obsId + '"][data-dyworker-ref="' + ref + '"]');
          if (direct) {
            return { el: direct, offsetX, offsetY };
          }
        } catch (e) {}

        try {
          const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT, null);
          let curr = walker.nextNode();
          while (curr) {
            if (curr.shadowRoot) {
              const found = findTargetDeep(curr.shadowRoot, obsId, ref, offsetX, offsetY);
              if (found) return found;
            }
            if (curr.tagName && curr.tagName.toLowerCase() === "iframe") {
              try {
                if (curr.contentDocument && curr.contentDocument.body) {
                  const ifRect = curr.getBoundingClientRect();
                  const ifStyle = window.getComputedStyle(curr);
                  const bl = parseFloat(ifStyle.borderLeftWidth) || 0;
                  const bt = parseFloat(ifStyle.borderTopWidth) || 0;
                  const pl = parseFloat(ifStyle.paddingLeft) || 0;
                  const pt = parseFloat(ifStyle.paddingTop) || 0;
                  const found = findTargetDeep(
                    curr.contentDocument,
                    obsId,
                    ref,
                    offsetX + ifRect.x + bl + pl,
                    offsetY + ifRect.y + bt + pt
                  );
                  if (found) return found;
                }
              } catch (e) {}
            }
            curr = walker.nextNode();
          }
        } catch (e) {}

        return null;
      }

      const match = findTargetDeep(document, ${JSON.stringify(obs.observationId)}, ${JSON.stringify(String(ref))});
      if (!match) return { ok: false, reason: "NOT_FOUND_OR_REPLACED" };

      const { el, offsetX, offsetY } = match;
      const expectedStamp = ${JSON.stringify(obs.observationId + ":" + ref)};
      if (el.__dyworker_node_stamp !== expectedStamp) {
        return { ok: false, reason: "NODE_REPLACED" };
      }

      const tag = el.tagName.toLowerCase();
      if (tag !== ${JSON.stringify(expected.tag)}) return { ok: false, reason: "TAG_MISMATCH" };

      // 语义核验：比对元素实际名称，严禁 cloneNode 或篡改文本后冒充原控件 (F3_replaced_node / 补充要求 3)
      const isPw = (el.getAttribute("type") || el.type || "").toLowerCase() === "password";
      const isEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";
      let currentName = "";
      if (isPw) {
        currentName = el.getAttribute("aria-label") || el.placeholder || el.getAttribute("title") || "密码输入框";
      } else if (isEditable) {
        currentName = (el.innerText || el.textContent || "富文本编辑区").replace(/\\s+/g, " ").trim().slice(0, 60);
      } else {
        currentName = (
          el.getAttribute("aria-label") ||
          el.innerText ||
          el.placeholder ||
          el.value ||
          el.getAttribute("title") ||
          ""
        ).replace(/\\s+/g, " ").trim().slice(0, 80);
      }
      const expectedName = ${JSON.stringify(expected.name || "")};
      if (expectedName && currentName !== expectedName) {
        return { ok: false, reason: "SEMANTIC_CHANGED", detail: "期望语义: " + expectedName + ", 当前语义: " + currentName };
      }

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") {
        return { ok: false, reason: "NOT_VISIBLE" };
      }

      // 计算相对于主窗口的绝对坐标
      const cx = Math.round(rect.x + rect.width / 2 + offsetX);
      const cy = Math.round(rect.y + rect.height / 2 + offsetY);

      // 遮挡检测：从顶层视口向下通用逐层穿透（支持 iframe 与开放 ShadowRoot 任意组合，F8_iframe_shadow_combination / F3_iframe_inner_cover）
      function getDeepHitAtPoint(doc, ptX, ptY) {
        if (!doc || !doc.elementFromPoint) return null;
        let curr = doc.elementFromPoint(ptX, ptY);
        if (!curr) return null;

        while (curr) {
          // 1. 如果命中是同源 iframe，穿透进 iframe 文档
          if (curr.tagName && curr.tagName.toLowerCase() === "iframe") {
            try {
              if (curr.contentDocument && curr.contentDocument.elementFromPoint) {
                const rect = curr.getBoundingClientRect();
                const style = window.getComputedStyle(curr);
                const bl = parseFloat(style.borderLeftWidth) || 0;
                const bt = parseFloat(style.borderTopWidth) || 0;
                const pl = parseFloat(style.paddingLeft) || 0;
                const pt = parseFloat(style.paddingTop) || 0;
                const subX = ptX - (rect.x + bl + pl);
                const subY = ptY - (rect.y + bt + pt);
                const nextHit = curr.contentDocument.elementFromPoint(subX, subY);
                if (nextHit && nextHit !== curr) {
                  ptX = subX;
                  ptY = subY;
                  curr = nextHit;
                  continue;
                }
              }
            } catch {}
          }

          // 2. 如果命中元素拥有开放 ShadowRoot，穿透进 ShadowRoot
          if (curr.shadowRoot && curr.shadowRoot.elementFromPoint) {
            try {
              const shadowHit = curr.shadowRoot.elementFromPoint(ptX, ptY);
              if (shadowHit && shadowHit !== curr) {
                curr = shadowHit;
                continue;
              }
            } catch {}
          }

          break;
        }
        return curr;
      }

      const deepHit = getDeepHitAtPoint(document, cx, cy);
      const isAllowedHit = Boolean(deepHit && (deepHit === el || (el.contains && el.contains(deepHit))));

      if (!isAllowedHit) {
        return { ok: false, reason: "OCCLUDED", hitTag: deepHit ? deepHit.tagName : "unknown" };
      }

      return {
        ok: true,
        coords: { x: cx, y: cy },
        isContentEditable: isEditable
      };
    })()`;

    const res = await this.contents.executeJavaScript(script, true);
    if (!res || !res.ok) {
      throw new Error(`STALE_OBSERVATION: 元素身份已改变或被遮挡（原因: ${res?.reason || "未知"}），请重新观察`);
    }

    return res;
  }

  /**
   * 执行原子交互动作
   */
  async act({ observationId, action }, { signal, checkLease } = {} as any) {
    if (this.isDestroyed()) throw new Error("TARGET_UNAVAILABLE: 目标页面已销毁");

    // 动作执行前首先检查中断和租约
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或接管");
    }

    const validation = this.validateObservation(observationId);
    if (!validation.ok) {
      return { ok: false, errorCode: "STALE_OBSERVATION", result: validation.error };
    }

    const obs = validation.observation;

    // 关键校验 (F3_coordinate_resize / 补充要求 3)：
    // 无论 ref 还是 point 动作，执行前均核实当前视口尺寸，窗口缩放或拖拽面板宽度后旧操作必须失效！
    try {
      const curViewport = await this.contents.executeJavaScript(
        "({ width: window.innerWidth, height: window.innerHeight })",
        true
      );
      if (
        curViewport &&
        typeof curViewport.width === "number" &&
        typeof curViewport.height === "number" &&
        (curViewport.width !== obs.viewport.cssWidth || curViewport.height !== obs.viewport.cssHeight)
      ) {
        return {
          ok: false,
          errorCode: "STALE_OBSERVATION",
          result: "STALE_OBSERVATION: 视口尺寸或面板宽度已发生变化，原坐标与观察已失效，请重新观察"
        };
      }
    } catch {
      // 忽略
    }

    const actionType = action?.type;

    try {
      switch (actionType) {
        case "click":
        case "double_click":
        case "hover": {
          const target = await this.resolveTarget(action, obs);
          return await this.dispatchMouseAction(actionType, target.coords, { signal, checkLease });
        }

        case "type": {
          return await this.dispatchTypeAction(action, obs, { signal, checkLease });
        }

        case "keypress": {
          const key = String(action?.key || "");
          if (!key) return { ok: false, result: "缺少 key 参数" };
          return await this.dispatchKeypress(key, { signal, checkLease });
        }

        case "scroll": {
          return await this.dispatchScroll(action, obs, { signal, checkLease });
        }

        case "select": {
          return await this.dispatchSelect(action, obs, { signal, checkLease });
        }

        case "drag": {
          return await this.dispatchDrag(action, obs, { signal, checkLease });
        }

        default:
          return { ok: false, errorCode: "UNKNOWN_ACTION", result: `不支持的动作类型: ${actionType}` };
      }
    } catch (err: any) {
      // 若是因租约撤销或接管触发的异常，向外抛出或返回 LEASE_REVOKED
      if (err.message.includes("LEASE_REVOKED")) {
        return { ok: false, errorCode: "LEASE_REVOKED", result: err.message };
      }
      return { ok: false, errorCode: "ACTION_FAILED", result: `动作执行出错: ${err.message}` };
    }
  }

  /**
   * 解析目标坐标与进行深度校验
   */
  async resolveTarget(action, obs) {
    // 坐标操作熔断：若未提供有效图片，严禁进行坐标点击，防止盲点 (F8)
    if (action.point && typeof action.point.x === "number" && typeof action.point.y === "number") {
      if (!obs.images || obs.images.length === 0) {
        throw new Error("VISUAL_UNAVAILABLE: 当前未获取页面截图，为防误触已禁用坐标点击，请使用语义 ref 或人工接管");
      }
      const coords = mapImageCoordinateToCss(action.point, obs.viewport);
      return { coords };
    }

    if (action.ref !== undefined && action.ref !== null) {
      const ref = Number(action.ref);
      const verified = await this.verifyTargetElement(ref, obs);
      return { coords: verified.coords, isContentEditable: verified.isContentEditable };
    }

    throw new Error("INVALID_TARGET: 动作必须指定 ref 编号或 point 坐标");
  }

  /**
   * 分发鼠标动作（F1 关键：在每步 CDP 动作之间核查接管，接管后绝对不派发 mousePressed）
   */
  async dispatchMouseAction(type, coords, { signal, checkLease } = {} as any) {
    const { x, y } = coords;
    const hasDebugger = await this.ensureDebugger();

    // 检查点 1：开始动作前
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    if (hasDebugger) {
      if (type === "hover") {
        await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, { signal, checkLease });
        return { ok: true, result: `已悬停于 (${x}, ${y})` };
      }

      const clickCount = type === "double_click" ? 2 : 1;

      // 移动光标
      await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, { signal, checkLease });

      // 检查点 2：光标移动后、按压前（核心复现拦截点！接管在此发生时严禁执行后续按压）
      if (signal?.aborted || checkLease?.() === false) {
        throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管，已拦截按压");
      }

      // 按下鼠标
      try {
        await this.sendCDP("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount
        }, { signal, checkLease });
        this.lastInputState.mouseDown = true;
      } catch (err: any) {
        this.lastInputState.mouseDown = false;
        throw err;
      }

      // 检查点 3：按压后、释放前（即使在此接管，也必须在 finally 中正常 release，不可残留按下态）
      try {
        if (signal?.aborted || checkLease?.() === false) {
          throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
        }
      } finally {
        await this.sendCDPCleanup("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount
        });
        this.lastInputState.mouseDown = false;
      }

      return { ok: true, result: `${type === "double_click" ? "已双击" : "已点击"}坐标 (${x}, ${y})` };
    }

    // DOM 级点击回退
    const domClickScript = `(() => {
      const el = document.elementFromPoint(${x}, ${y});
      if (!el) return "未找到坐标位置的元素";
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return "已点击元素：" + (el.innerText || el.tagName);
    })()`;
    const res = await this.contents.executeJavaScript(domClickScript, true);
    return { ok: true, result: String(res) };
  }

  /**
   * 分发文本输入（支持普通 input 与 contenteditable 区域，修复 F8）
   */
  async dispatchTypeAction(action, obs, { signal, checkLease } = {} as any) {
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    const text = String(action?.text ?? "");
    const mode = action?.mode || "replace";

    if (action.ref !== undefined && action.ref !== null) {
      const ref = Number(action.ref);
      const verified = await this.verifyTargetElement(ref, obs);

      // 先点击聚焦
      await this.dispatchMouseAction("click", verified.coords, { signal, checkLease });

      if (signal?.aborted || checkLease?.() === false) {
        throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
      }

      // 穿透深层查找与设值（支持标准 DOM、开放 Shadow DOM、同源 iframe 与富文本）
      const typeScript = `(() => {
        function findTargetDeep(root, obsId, refStr) {
          if (!root) return null;
          const selector = '[data-dyworker-obs="' + obsId + '"][data-dyworker-ref="' + refStr + '"]';
          try {
            const direct = root.querySelector(selector);
            if (direct) return direct;
          } catch (e) {}

          try {
            const iframes = Array.from(root.querySelectorAll("iframe"));
            for (const iframe of iframes) {
              try {
                if (iframe.contentDocument && iframe.contentDocument.body) {
                  const found = findTargetDeep(iframe.contentDocument, obsId, refStr);
                  if (found) return found;
                }
              } catch (e) {}
            }
          } catch (e) {}

          try {
            const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT, null);
            let curr = walker.nextNode();
            while (curr) {
              if (curr.shadowRoot) {
                const found = findTargetDeep(curr.shadowRoot, obsId, refStr);
                if (found) return found;
              }
              curr = walker.nextNode();
            }
          } catch (e) {}

          return null;
        }

        const el = findTargetDeep(document, ${JSON.stringify(obs.observationId)}, ${JSON.stringify(String(ref))});
        if (!el) return { ok: false, error: "未找到目标输入框或元素已失效" };

        const expectedStamp = ${JSON.stringify(obs.observationId + ":" + ref)};
        if (el.__dyworker_node_stamp !== expectedStamp) {
          return { ok: false, error: "目标输入框身份已发生变化" };
        }

        el.focus();
        const isEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";
        if (isEditable) {
          if (${JSON.stringify(mode)} === "replace") {
            el.innerText = ${JSON.stringify(text)};
          } else {
            el.innerText = (el.innerText || "") + ${JSON.stringify(text)};
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, value: el.innerText };
        }

        const prevValue = el.value || "";
        const nextValue = ${mode === "append" ? `prevValue + ${JSON.stringify(text)}` : JSON.stringify(text)};
        const isPw = (el.getAttribute("type") || el.type || "").toLowerCase() === "password" ||
          Boolean(el.getAttribute("autocomplete")?.toLowerCase().includes("password"));
        const isTextarea = el.tagName.toLowerCase() === "textarea";
        const win = el.ownerDocument?.defaultView || window;
        const proto = isTextarea
          ? (win.HTMLTextAreaElement?.prototype || HTMLTextAreaElement.prototype)
          : (win.HTMLInputElement?.prototype || HTMLInputElement.prototype);
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor?.set) {
          descriptor.set.call(el, nextValue);
        } else {
          el.value = nextValue;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

        if (el.value !== nextValue) {
          return { ok: false, error: "写入值核验不匹配" };
        }
        return { ok: true, value: isPw ? "[PROTECTED]" : el.value, isPassword: isPw };
      })()`;

      const typeRes = await this.contents.executeJavaScript(typeScript, true);
      if (!typeRes || !typeRes.ok) {
        return { ok: false, errorCode: "TYPE_FAILED", result: typeRes?.error || "输入失败" };
      }
      if (typeRes.isPassword) {
        return { ok: true, result: `已安全输入密码（${text.length} 个字符）` };
      }
      return { ok: true, result: `已输入：${text}` };
    }

    // CDP insertText
    const hasDebugger = await this.ensureDebugger();
    if (hasDebugger) {
      await this.sendCDP("Input.insertText", { text }, { signal, checkLease });
      return { ok: true, result: `已键入文本 (${text.length} 字符)` };
    }

    return { ok: false, result: "未指定目标输入元素且 CDP 调试通道不可用" };
  }

  /**
   * 分发快捷按键
   */
  async dispatchKeypress(key, { signal, checkLease } = {} as any) {
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    const hasDebugger = await this.ensureDebugger();
    if (hasDebugger) {
      const keyMap = {
        "Enter": { key: "Enter", code: "Enter", keyCode: 13 },
        "Backspace": { key: "Backspace", code: "Backspace", keyCode: 8 },
        "Tab": { key: "Tab", code: "Tab", keyCode: 9 },
        "Escape": { key: "Escape", code: "Escape", keyCode: 27 },
        "ArrowDown": { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
        "ArrowUp": { key: "ArrowUp", code: "ArrowUp", keyCode: 38 }
      };
      const def = keyMap[key] || { key, code: key, keyCode: 0 };

      await this.sendCDP("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode
      }, { signal, checkLease });

      if (signal?.aborted || checkLease?.() === false) {
        await this.sendCDPCleanup("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.keyCode
        });
        throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
      }

      await this.sendCDPCleanup("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode
      });
      return { ok: true, result: `已触发按键：${key}` };
    }

    const res = await this.contents.executeJavaScript(`(() => {
      const active = document.activeElement || document.body;
      const event = new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true });
      active.dispatchEvent(event);
      return "已派发 DOM 按键事件";
    })()`, true);
    return { ok: true, result: String(res) };
  }

  /**
   * 分发滚动
   */
  async dispatchScroll(action, obs, { signal, checkLease } = {} as any) {
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    const deltaX = Number(action?.deltaX) || 0;
    const deltaY = Number(action?.deltaY) || 0;

    let targetCoords = { x: Math.round(obs.viewport.cssWidth / 2), y: Math.round(obs.viewport.cssHeight / 2) };
    if (action.ref !== undefined) {
      const target = await this.resolveTarget(action, obs);
      targetCoords = target.coords;
    }

    const hasDebugger = await this.ensureDebugger();
    if (hasDebugger) {
      await this.sendCDP("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: targetCoords.x,
        y: targetCoords.y,
        deltaX,
        deltaY
      }, { signal, checkLease });
      return { ok: true, result: `已滚动视口 (deltaX: ${deltaX}, deltaY: ${deltaY})` };
    }

    await this.contents.executeJavaScript(`window.scrollBy(${deltaX}, ${deltaY})`, true);
    return { ok: true, result: `已通过 JS 滚动视口 (${deltaX}, ${deltaY})` };
  }

  /**
   * 下拉框选择（支持同源 iframe 与开放 Shadow DOM 穿透，异步后复核接管状态）。
   * 目标节点被页面替换后保守判定失效，不借用其他控件确认成功 (C3)。
   */
  async dispatchSelect(action, obs, { signal, checkLease } = {} as any) {
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    const ref = Number(action?.ref);
    await this.verifyTargetElement(ref, obs);

    // 关键复核点：verifyTargetElement 异步完成后、实际修改 DOM 之前核查接管 (F1_select_after_takeover)
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }

    const script = buildSelectScript({
      observationId: obs.observationId,
      ref,
      value: action?.value,
      label: action?.label
    });

    const res = await this.contents.executeJavaScript(script, true);
    if (!res || !res.ok) {
      return { ok: false, errorCode: "SELECT_FAILED", result: res?.error || "选择操作未成功完成" };
    }
    return { ok: true, result: `已选中选项：${res.text || res.value}` };
  }

  /**
   * 拖拽交互
   */
  async dispatchDrag(action, obs, { signal, checkLease } = {} as any) {
    if (signal?.aborted || checkLease?.() === false) {
      throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
    }
    if (!obs?.images || obs.images.length === 0) {
      throw new Error("VISUAL_UNAVAILABLE: 当前未获取页面截图，为防误触已禁用坐标拖拽，请先获取截图或人工接管");
    }
    if (!action.from || !action.to) throw new Error("INVALID_DRAG: 必须指定 from 和 to 坐标");

    const start = mapImageCoordinateToCss(action.from, obs.viewport);
    const end = mapImageCoordinateToCss(action.to, obs.viewport);

    const hasDebugger = await this.ensureDebugger();
    if (!hasDebugger) return { ok: false, result: "拖拽需要 CDP 协议支持" };

    await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y }, { signal, checkLease });
    if (signal?.aborted || checkLease?.() === false) throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");

    try {
      await this.sendCDP("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left" }, { signal, checkLease });
      this.lastInputState.mouseDown = true;

      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        if (signal?.aborted || checkLease?.() === false) throw new Error("LEASE_REVOKED: 控制已被撤销或用户已接管");
        const curX = Math.round(start.x + (end.x - start.x) * (i / steps));
        const curY = Math.round(start.y + (end.y - start.y) * (i / steps));
        await this.sendCDP("Input.dispatchMouseEvent", { type: "mouseMoved", x: curX, y: curY, button: "left" }, { signal, checkLease });
      }
    } finally {
      await this.sendCDPCleanup("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left" });
      this.lastInputState.mouseDown = false;
    }

    return { ok: true, result: `已完成从 (${start.x}, ${start.y}) 到 (${end.x}, ${end.y}) 的拖拽` };
  }

  /**
   * 释放未完成的按键或鼠标状态（接管或中断时调用）
   */
  async releaseInputState() {
    if (this.isDestroyed()) return;
    try {
      if (this.debuggerAttached && this.lastInputState.mouseDown) {
        await this.sendCDPCleanup("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: 0,
          y: 0,
          button: "left"
        });
        this.lastInputState.mouseDown = false;
      }
      if (this.debuggerAttached && this.lastInputState.keyDown) {
        await this.sendCDPCleanup("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: this.lastInputState.keyDown
        });
        this.lastInputState.keyDown = null;
      }
    } catch {
      // 忽略清理异常
    }
  }

  /**
   * 条件等待
   */
  async wait({ condition = {}, timeoutMs = 15000, signal, checkLease } = {} as any) {
    const startedAt = Date.now();
    const interval = 150;

    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted || checkLease?.() === false) {
        throw new Error("WAIT_ABORTED: 等待已被取消或用户已接管");
      }

      if (condition.type === "url_contains" && condition.value) {
        const currentUrl = this.contents?.getURL?.() || "";
        if (currentUrl.includes(condition.value)) {
          return { ok: true, result: `已到达包含目标字符串的网址：${currentUrl}` };
        }
      }

      if (condition.type === "text_present" && condition.value) {
        try {
          const bodyText = await this.contents?.executeJavaScript("document.body?.innerText || ''", true);
          if (bodyText && bodyText.includes(condition.value)) {
            return { ok: true, result: `页面已出现目标文字：${condition.value}` };
          }
        } catch {
          // 忽略
        }
      }

      if (condition.type === "element_present" && condition.selector) {
        try {
          const exists = await this.contents?.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(condition.selector)}))`, true);
          if (exists) {
            return { ok: true, result: `目标元素已就绪：${condition.selector}` };
          }
        } catch {
          // 忽略
        }
      }

      await new Promise<any>((resolve) => setTimeout(resolve, interval));
    }

    return { ok: false, errorCode: "WAIT_TIMEOUT", result: `等待超时（${timeoutMs / 1000} 秒），条件未满足` };
  }

  dispose() {
    try {
      if (this.contents && !this.isDestroyed()) {
        try {
          if (this.contents.debugger?.isAttached?.()) {
            this.contents.debugger.detach();
          }
        } catch {
          // 忽略 detach 异常
        }
      }
    } catch {
      // 忽略检查异常
    }
    this.contents = null;
    this.debuggerAttached = false;
    this.currentObservation = null;
    this.observationHistory.clear();
  }
}
