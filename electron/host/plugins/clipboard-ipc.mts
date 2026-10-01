// IPC 域插件：剪贴板（clipboard:*）。
// 渲染进程的 navigator.clipboard 在部分 Electron 版本不可用，文本/图片都走主进程原生剪贴板。
export function clipboardIpcPlugin(deps) {
  return {
    name: "ipc:clipboard",
    apply(ctx) {
      const { trustedHandle, clipboard, nativeImage, localImagePathFromSource, fs, isTrustedRendererUrl } = deps;

      trustedHandle("clipboard:read-text", (event) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return "";
        try {
          return clipboard.readText();
        } catch {
          return "";
        }
      });

      trustedHandle("clipboard:write-text", (event, text) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false };
        clipboard.writeText(String(text ?? ""));
        return { ok: true };
      });

      // 复制图片改走主进程原生剪贴板（clipboard.writeImage），粘贴到画图/聊天等应用最稳
      trustedHandle("clipboard:write-image", async (event, payload) => {
        if (!isTrustedRendererUrl(event.senderFrame?.url)) return { ok: false, error: "当前页面不允许写入剪贴板图片" };
        try {
          let image = null;
          const dataUrl = String(payload?.dataUrl || "");
          if (dataUrl.startsWith("data:image/")) {
            image = nativeImage.createFromDataURL(dataUrl);
          } else {
            const filePath = localImagePathFromSource(payload?.path);
            if (filePath) {
              const content = await fs.readFile(filePath);
              if (content.length) image = nativeImage.createFromBuffer(content);
            }
          }
          if (!image || image.isEmpty()) return { ok: false, error: "图片无法复制" };
          clipboard.writeImage(image);
          return { ok: true };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
    },
  };
}
