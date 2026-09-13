// 内置浏览器 webview 的专用 preload：只向页面暴露“报告密码表单提交”一个能力。
// 安全边界：nodeIntegration 关闭、contextIsolation 开启、sandbox 开启（见 main.mjs 的
// will-attach-webview），页面无法触及 ipcRenderer，只能调用这一个桥接函数；
// 数据只发给宿主渲染进程（面板），由用户确认后才落盘。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dyworkerPage", {
  reportPasswordSubmit: (payload) => ipcRenderer.sendToHost("dyworker:password-submit", payload),
});

// 捕获登录表单提交：找到密码框和它前面的用户名框，报告明文（面板会先征求用户同意）。
// DOM 在隔离世界与页面世界共享，事件监听能观察到页面触发的 submit。
const hookFormSubmits = () => {
  document.addEventListener("submit", (event) => {
    try {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const password = [...form.querySelectorAll("input[type=password]")].find((input) => input.value);
      if (!password) return;
      const fields = [...form.querySelectorAll("input")];
      const passwordIndex = fields.indexOf(password);
      const username = [...fields.slice(0, passwordIndex)]
        .reverse()
        .find((input) => ["text", "email", "tel", ""].includes(input.type)
          || /username|email|account|phone|user/i.test(`${input.name} ${input.id} ${input.autocomplete}`));
      window.dyworkerPage?.reportPasswordSubmit({
        origin: location.origin,
        username: username?.value || "",
        password: password.value,
      });
    } catch {
      // 单个表单异常不影响页面本身
    }
  }, true);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hookFormSubmits, { once: true });
} else {
  hookFormSubmits();
}
