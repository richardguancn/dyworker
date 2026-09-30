import test from "node:test";
import assert from "node:assert/strict";
import { BrowserPageAdapter, buildSelectScript, mapImageCoordinateToCss } from "../electron/browser-page-adapter.mts";

test("mapImageCoordinateToCss: 正确将截图像素映射到页面 CSS 坐标", () => {
  const viewport = {
    cssWidth: 800,
    cssHeight: 600,
    imageWidth: 1600,
    imageHeight: 1200,
    cropX: 0,
    cropY: 0
  };

  // 中心点 (800, 600) 应该映射为 (400, 300)
  const mapped = mapImageCoordinateToCss({ x: 800, y: 600 }, viewport);
  assert.equal(mapped.x, 400);
  assert.equal(mapped.y, 300);

  // 原点
  const origin = mapImageCoordinateToCss({ x: 0, y: 0 }, viewport);
  assert.equal(origin.x, 0);
  assert.equal(origin.y, 0);

  // 带裁剪偏移
  const croppedViewport = { ...viewport, cropX: 50, cropY: 30 };
  const cropped = mapImageCoordinateToCss({ x: 400, y: 300 }, croppedViewport);
  assert.equal(cropped.x, 250); // 400 * 0.5 + 50
  assert.equal(cropped.y, 180); // 300 * 0.5 + 30
});

test("mapImageCoordinateToCss: 异常参数防御", () => {
  const validViewport = { cssWidth: 800, cssHeight: 600, imageWidth: 1600, imageHeight: 1200 };
  assert.throws(() => mapImageCoordinateToCss(null, validViewport), /无效的坐标输入/);
  assert.throws(() => mapImageCoordinateToCss({ x: "bad", y: 10 }, validViewport), /无效的坐标输入/);
  assert.throws(() => mapImageCoordinateToCss({ x: 10, y: 10 }, null), /无效的视口信息/);
  assert.throws(() => mapImageCoordinateToCss({ x: 10, y: 10 }, { ...validViewport, imageWidth: 0 }), /无效的视口信息/);
});

// 构建模拟的 webContents 对象
function createMockWebContents({ url = "https://example.com/test", title = "测试页面" } = {}) {
  const sentCDPCommands = [];
  const executedScripts = [];

  const mockDebugger = {
    attached: false,
    isAttached() {
      return this.attached;
    },
    attach() {
      this.attached = true;
    },
    detach() {
      this.attached = false;
    },
    on() {},
    async sendCommand(method, params) {
      sentCDPCommands.push({ method, params });
      return { ok: true };
    }
  };

  const contents = {
    id: 42,
    debugger: mockDebugger,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => title,
    executeJavaScript: async (script) => {
      executedScripts.push(script);
      if (typeof script === "string" && (script.includes("NOT_FOUND_OR_REPLACED") || script.includes("coords"))) {
        return { ok: true, coords: { x: 140, y: 215 }, isContentEditable: false };
      }
      // 模拟 EXTRACT_ELEMENTS_SCRIPT 的返回
      return {
        title,
        url,
        totalCount: 2,
        elements: [
          {
            ref: 0,
            tag: "button",
            type: "submit",
            role: "button",
            name: "提交查询",
            href: "",
            enabled: true,
            checked: false,
            rect: { x: 100, y: 200, width: 80, height: 30 }
          },
          {
            ref: 1,
            tag: "input",
            type: "text",
            role: "textbox",
            name: "搜索关键字",
            href: "",
            enabled: true,
            checked: false,
            rect: { x: 100, y: 150, width: 200, height: 30 }
          }
        ],
        viewport: {
          cssWidth: 1024,
          cssHeight: 768,
          devicePixelRatio: 2
        }
      };
    },
    capturePage: async () => {
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 2048, height: 1536 }),
        toPNG: () => Buffer.from("mock_png_binary_data")
      };
    },
    sentCDPCommands,
    executedScripts
  };

  return contents;
}

test("BrowserPageAdapter: observe 提取语义树与视口截图", async () => {
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);

  const obs = await adapter.observe();
  assert.ok(obs.observationId.startsWith("obs_"));
  assert.equal(obs.title, "测试页面");
  assert.equal(obs.url, "https://example.com/test");
  assert.equal(obs.elements.length, 2);
  assert.equal(obs.elements[0].name, "提交查询");
  assert.equal(obs.viewport.cssWidth, 1024);
  assert.equal(obs.viewport.imageWidth, 2048);
  assert.equal(obs.images.length, 1);
  assert.equal(obs.images[0].mimeType, "image/png");
  assert.ok(obs.summary.includes("提交查询"));

  adapter.dispose();
});

test("BrowserPageAdapter: validateObservation 拦截过期或缺失的 observationId", async () => {
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);

  const obs = await adapter.observe();
  assert.ok(adapter.validateObservation(obs.observationId).ok);

  const wrongValidation = adapter.validateObservation("stale_id_999");
  assert.equal(wrongValidation.ok, false);
  assert.match(wrongValidation.error, /STALE_OBSERVATION/);

  const emptyValidation = adapter.validateObservation("");
  assert.equal(emptyValidation.ok, false);
  assert.match(emptyValidation.error, /STALE_OBSERVATION/);

  adapter.dispose();
});

test("BrowserPageAdapter: act 执行点击动作（语义 ref 与坐标）", async () => {
  const mockContents = createMockWebContents();
  const adapter = new BrowserPageAdapter(mockContents);
  const obs = await adapter.observe();

  // 1. 语义点击 ref 0 (中心位于 100+40=140, 200+15=215)
  const clickRefResult = await adapter.act({
    observationId: obs.observationId,
    action: { type: "click", ref: 0 }
  });
  assert.equal(clickRefResult.ok, true);

  // 验证 CDP 调用记录
  const mousePressedCmd = mockContents.sentCDPCommands.find((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mousePressed");
  assert.ok(mousePressedCmd);
  assert.equal(mousePressedCmd.params.x, 140);
  assert.equal(mousePressedCmd.params.y, 215);

  // 2. 坐标点击（图片坐标 400, 300 映射到 CSS 200, 150）
  const clickPointResult = await adapter.act({
    observationId: obs.observationId,
    action: { type: "click", point: { x: 400, y: 300 } }
  });
  assert.equal(clickPointResult.ok, true);

  const pointCmd = mockContents.sentCDPCommands.filter((c) => c.method === "Input.dispatchMouseEvent" && c.params.type === "mousePressed").pop();
  assert.equal(pointCmd.params.x, 200);
  assert.equal(pointCmd.params.y, 150);

  adapter.dispose();
});

test("BrowserPageAdapter: wait 支持条件提前退出与超时机制", async () => {
  const mockContents = createMockWebContents({ url: "https://example.com/step-1" });
  const adapter = new BrowserPageAdapter(mockContents);

  // URL 匹配立即成功
  const waitUrlRes = await adapter.wait({
    condition: { type: "url_contains", value: "step-1" },
    timeoutMs: 500
  });
  assert.equal(waitUrlRes.ok, true);

  // URL 不匹配超时
  const timeoutRes = await adapter.wait({
    condition: { type: "url_contains", value: "never-match" },
    timeoutMs: 200
  });
  assert.equal(timeoutRes.ok, false);
  assert.equal(timeoutRes.errorCode, "WAIT_TIMEOUT");

  adapter.dispose();
});

// ---- buildSelectScript 页内脚本的轻量 fake DOM 测试 (D3) ----

globalThis.NodeFilter ??= { SHOW_ELEMENT: 4 };

function fakeOption(value, text, selected = false) {
  return { value, text, selected };
}

function fakeSelect({ obsId, ref, stamp, options, onChange, ariaLabel = "" } = {}) {
  // 模拟真实 DOM 行为：选中一个 option 会自动取消其他 option 的选中状态
  const opts = [];
  for (const o of options) {
    const opt = { value: o.value, text: o.text, _selected: !!o.selected };
    Object.defineProperty(opt, "selected", {
      get() { return this._selected; },
      set(v) {
        if (v) for (const other of opts) other._selected = false;
        this._selected = !!v;
      }
    });
    opts.push(opt);
  }
  const el = {
    tagName: "SELECT",
    isConnected: true,
    shadowRoot: null,
    children: [],
    attrs: {},
    listeners: {},
    __dyworker_node_stamp: stamp,
    get options() { return opts; },
    get value() { return (opts.find((o) => o.selected) || {}).value || ""; },
    get selectedOptions() { return opts.filter((o) => o.selected); },
    getAttribute(name) { return this.attrs[name] ?? null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(event) {
      for (const fn of this.listeners[event.type] || []) fn(event);
      return true;
    }
  };
  if (obsId) {
    el.attrs["data-dyworker-obs"] = obsId;
    el.attrs["data-dyworker-ref"] = String(ref);
  }
  if (ariaLabel) el.attrs["aria-label"] = ariaLabel;
  if (onChange) el.addEventListener("change", () => onChange(el));
  return el;
}

function fakeRoot(children) {
  const deepFind = (list, pred) => {
    for (const el of list) {
      if (pred(el)) return el;
      const found = deepFind(el.children || [], pred);
      if (found) return found;
    }
    return null;
  };
  const deepFindAll = (list, pred, out = []) => {
    for (const el of list) {
      if (pred(el)) out.push(el);
      deepFindAll(el.children || [], pred, out);
    }
    return out;
  };
  return {
    children,
    querySelector(selector) {
      const m = selector.match(/\[data-dyworker-obs="([^"]*)"\]\[data-dyworker-ref="([^"]*)"\]/);
      if (!m) return null;
      return deepFind(children, (el) =>
        el.isConnected &&
        el.attrs?.["data-dyworker-obs"] === m[1] &&
        el.attrs?.["data-dyworker-ref"] === m[2]
      );
    },
    querySelectorAll(selector) {
      if (selector === "iframe") return deepFindAll(children, (el) => el.tagName === "IFRAME");
      return [];
    }
  };
}

function fakeDocument(children) {
  const root = fakeRoot(children);
  root.body = { children };
  root.createTreeWalker = (walkRoot) => {
    const all = [];
    const walk = (list) => {
      for (const el of list) {
        all.push(el);
        walk(el.children || []);
      }
    };
    walk(walkRoot?.children || []);
    let i = 0;
    return { nextNode: () => all[i++] || null };
  };
  return root;
}

async function runSelectScript(doc, params) {
  const prevDoc = globalThis.document;
  globalThis.document = doc;
  try {
    return await eval(buildSelectScript(params));
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
}

test("buildSelectScript: 目标下拉框被替换后不得借其他控件确认成功 (D3)", async () => {
  const obsId = "obs_d3";
  // “其他类型”已为乙——正是旧实现误判成功时借用的无关控件
  const peer = fakeSelect({
    ariaLabel: "其他类型",
    options: [fakeOption("a", "甲"), fakeOption("b", "乙", true)]
  });
  const docChildren = [peer];
  const doc = fakeDocument(docChildren);
  const target = fakeSelect({
    obsId,
    ref: 5,
    stamp: `${obsId}:5`,
    ariaLabel: "目标类型",
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")],
    onChange: (el) => {
      // 页面事件处理用新控件替换自身，新控件仍为甲
      el.isConnected = false;
      docChildren.push(fakeSelect({
        ariaLabel: "目标类型",
        options: [fakeOption("a", "甲", true), fakeOption("b", "乙")]
      }));
    }
  });
  docChildren.push(target);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 5, value: "b", label: "乙" });
  assert.equal(res.ok, false);
  assert.match(res.error, /替换或移除/);
  assert.equal(peer.value, "b");
});

test("buildSelectScript: 同名控件碰巧同值也不得作为替代目标 (D3)", async () => {
  const obsId = "obs_d3_same_name";
  // 与目标同名（aria-label 相同）且已为乙的无关控件
  const peer = fakeSelect({
    ariaLabel: "目标类型",
    options: [fakeOption("a", "甲"), fakeOption("b", "乙", true)]
  });
  const docChildren = [peer];
  const doc = fakeDocument(docChildren);
  const target = fakeSelect({
    obsId,
    ref: 6,
    stamp: `${obsId}:6`,
    ariaLabel: "目标类型",
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")],
    onChange: (el) => {
      el.isConnected = false;
      docChildren.push(fakeSelect({
        ariaLabel: "目标类型",
        options: [fakeOption("a", "甲", true), fakeOption("b", "乙")]
      }));
    }
  });
  docChildren.push(target);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 6, value: "b", label: "乙" });
  assert.equal(res.ok, false);
  assert.match(res.error, /替换或移除/);
});

test("buildSelectScript: Shadow DOM 中目标节点被替换后保守失效 (D3)", async () => {
  const obsId = "obs_d3_shadow";
  const shadowChildren = [];
  const shadowRoot = fakeRoot(shadowChildren);
  const host = { tagName: "DIV", isConnected: true, shadowRoot, children: [], attrs: {} };
  const target = fakeSelect({
    obsId,
    ref: 2,
    stamp: `${obsId}:2`,
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")],
    onChange: (el) => {
      el.isConnected = false;
      shadowChildren.push(fakeSelect({ options: [fakeOption("a", "甲", true)] }));
    }
  });
  shadowChildren.push(target);
  const doc = fakeDocument([host]);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 2, value: "b", label: "乙" });
  assert.equal(res.ok, false);
  assert.match(res.error, /替换或移除/);
});

test("buildSelectScript: iframe 中目标节点被替换后保守失效 (D3)", async () => {
  const obsId = "obs_d3_iframe";
  const innerChildren = [];
  const innerDoc = fakeDocument(innerChildren);
  const iframe = {
    tagName: "IFRAME",
    isConnected: true,
    shadowRoot: null,
    children: [],
    attrs: {},
    contentDocument: innerDoc
  };
  const target = fakeSelect({
    obsId,
    ref: 7,
    stamp: `${obsId}:7`,
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")],
    onChange: (el) => {
      el.isConnected = false;
      innerChildren.push(fakeSelect({ options: [fakeOption("a", "甲", true)] }));
    }
  });
  innerChildren.push(target);
  const doc = fakeDocument([iframe]);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 7, value: "b", label: "乙" });
  assert.equal(res.ok, false);
  assert.match(res.error, /替换或移除/);
});

test("buildSelectScript: 目标保持连接且值生效时返回成功", async () => {
  const obsId = "obs_ok";
  const target = fakeSelect({
    obsId,
    ref: 1,
    stamp: `${obsId}:1`,
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")]
  });
  const doc = fakeDocument([target]);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 1, value: "b", label: "乙" });
  assert.equal(res.ok, true);
  assert.equal(res.value, "b");
  assert.equal(res.text, "乙");
});

test("buildSelectScript: 页面逻辑重置选项值时判定失败", async () => {
  const obsId = "obs_reset";
  const target = fakeSelect({
    obsId,
    ref: 3,
    stamp: `${obsId}:3`,
    options: [fakeOption("a", "甲", true), fakeOption("b", "乙")],
    onChange: (el) => {
      // 页面逻辑把选择强制重置回甲
      for (const o of el.options) o.selected = o.value === "a";
    }
  });
  const doc = fakeDocument([target]);

  const res = await runSelectScript(doc, { observationId: obsId, ref: 3, value: "b", label: "乙" });
  assert.equal(res.ok, false);
  assert.match(res.error, /拒绝或重置/);
});

test("BrowserPageAdapter: webContents 已销毁时 dispose、releaseInputState 与 ensureDebugger 安全平稳退出", async () => {
  const fakeDestroyedWebContents = {
    id: 999,
    isDestroyed: () => true,
    get debugger() {
      throw new TypeError("Object has been destroyed");
    },
    getURL: () => {
      throw new TypeError("Object has been destroyed");
    },
    executeJavaScript: () => {
      throw new TypeError("Object has been destroyed");
    }
  };

  const adapter = new BrowserPageAdapter(fakeDestroyedWebContents);

  // 1. releaseInputState 不抛出异常
  await assert.doesNotReject(async () => {
    await adapter.releaseInputState();
  });

  // 2. ensureDebugger 抛出受控业务异常，而不是未经包装的 native TypeError
  await assert.rejects(
    async () => {
      await adapter.ensureDebugger();
    },
    (err) => err.message.includes("TARGET_DESTROYED")
  );

  // 3. dispose 绝不抛错，安全释放引用
  assert.doesNotThrow(() => {
    adapter.dispose();
  });
  assert.equal(adapter.contents, null);
  assert.equal(adapter.debuggerAttached, false);
});
