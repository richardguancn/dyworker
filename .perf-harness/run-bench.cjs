// 渲染基准运行器：Electron 载入基准页 → 等 App 挂载 → 跑场景 → 打印 JSON
// 用法：ELECTRON_RUN_AS_NODE 必须未设置；传入 messages/mode 由 npm script 封装
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// 每次运行使用独立临时配置，避免场景之间及与已安装应用互相污染。
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "dyw-perf-profile-")));
if (process.env.BENCH_CDP_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.BENCH_CDP_PORT);

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.disableHardwareAcceleration();

const here = __dirname;
const indexFile = path.join(here, "render-bench", process.env.BENCH_VARIANT === "before" ? "dist-before" : "dist", "index.html");
const messages = process.env.BENCH_MESSAGES || "120";
const mode = process.env.BENCH_MODE || "all";
const chunk = process.env.BENCH_CHUNK || "40";
const chars = process.env.BENCH_CHARS || "16000";
const nostart = process.env.BENCH_NOSTART === "1" ? "&nostart=1" : "";
const settlelast = process.env.BENCH_SETTLELAST === "1" ? "&settlelast=1" : "";

function waitFor(win, expression, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const value = await win.webContents.executeJavaScript(expression, true);
        if (value) return resolve(value);
      } catch (error) {
        // 页面尚未就绪：继续轮询
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${expression}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

app.whenReady().then(async () => {
  // BENCH_SHOT=/path.png：snapshot 模式下在「流式途中」截图，用于人工核对
  // 未定稿正文的 Markdown 排版（隐藏窗口截不到画面，所以要真显示一下）
  const shotPath = process.env.BENCH_SHOT || "";
  const win = new BrowserWindow({
    width: 1184,
    height: 736,
    show: Boolean(shotPath) || process.env.BENCH_MANUAL === "1",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  const errors = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) errors.push(message.slice(0, 400));
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("RENDER_GONE", JSON.stringify(details));
  });

  const platform = process.env.BENCH_PLATFORM === "linux" ? "linux" : "darwin";
  const url = `file://${indexFile}?messages=${messages}&mode=${mode}&chunk=${chunk}&chars=${chars}&platform=${platform}${nostart}${settlelast}`;
  await win.loadURL(url);

  try {
    await waitFor(win, "window.__perfReady === true", 60_000);
    if (process.env.BENCH_MANUAL === "1") { console.log("BENCH_MANUAL_READY"); return; }
    const processSamples = [];
    const sampleTimer = setInterval(() => processSamples.push(app.getAppMetrics().map(metric => ({
      pid: metric.pid, type: metric.type, cpu: metric.cpu, memory: metric.memory,
    }))), 1000);
    const runPromise = win.webContents.executeJavaScript("window.__perf.run()", true);
    if (shotPath) {
      await waitFor(win, 'document.title === "BENCH_SNAPSHOT_READY"', 120_000).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const image = await win.webContents.capturePage();
      require("node:fs").writeFileSync(shotPath, image.toPNG());
      console.log("BENCH_SHOT " + shotPath);
    }
    const result = await runPromise;
    clearInterval(sampleTimer);
    result.processSamples = processSamples;
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    console.log("BENCH_RESULT " + JSON.stringify(result));
  } catch (error) {
    process.exitCode = 1;
    console.log("BENCH_ERROR " + String(error && error.message ? error.message : error));
    const title = await win.webContents.executeJavaScript("document.title", true).catch(() => "?");
    console.log("BENCH_TITLE " + title);
  }

  if (errors.length) console.log("BENCH_CONSOLE " + JSON.stringify(errors.slice(0, 8)));
  app.exit(process.exitCode || 0);
});

setTimeout(() => {
  console.log("BENCH_ERROR global timeout");
  app.exit(1);
}, 180_000);
