// IPC 域插件：外观自定义（appearance:*）。
//
// 外观是"可变状态域"：appearanceState/appearanceEffective 被设置页、应用菜单与系统
// 主题事件共用，状态与窗口应用逻辑留在壳层；本插件经 deps.bridge 访问（读写都在同一处），
// 静态能力（保存/导入/读取/暂存回收/窗口材质）直接从 appearance*.mts import。
import { defaultAppearance, discardStagedImage, importAppearanceImage, readAppearanceImage, saveAppearance } from "../../appearance.mts";
import { applyWindowBackdrop, windowBackgroundFor } from "../../appearance-platform.mts";

export function appearanceIpcPlugin(deps) {
  return {
    name: "ipc:appearance",
    apply(ctx) {
      const { trustedHandle, bridge, dialog, nativeTheme, getMainWindow } = deps;

      trustedHandle("appearance:get", async () => bridge.snapshot());

      trustedHandle("appearance:capabilities", async () => ({ ...bridge.capabilities, platform: process.platform }));

      trustedHandle("appearance:save", async (_event, payload) => {
        const previousImageId = bridge.getState().settings.background.imageId;
        const result = await saveAppearance(bridge.file, payload?.settings, Number(payload?.revision));
        if (!result.ok) {
          return {
            ok: false,
            error: result.error,
            stale: result.stale === true,
            unknownVersion: result.unknownVersion === true,
            settings: result.settings || bridge.getState().settings,
            revision: result.revision ?? bridge.getState().revision,
          };
        }
        await bridge.applySavedResult(result, previousImageId);
        return bridge.snapshot();
      });

      trustedHandle("appearance:import-image", async () => {
        const picked = await dialog.showOpenDialog(getMainWindow(), {
          title: "选择背景图片",
          properties: ["openFile"],
          filters: [{ name: "图片 (PNG/JPEG/WebP)", extensions: ["png", "jpg", "jpeg", "webp"] }],
        });
        if (picked.canceled || !picked.filePaths[0]) return { ok: true, canceled: true };
        return importAppearanceImage(bridge.assetsDir, picked.filePaths[0], { process: bridge.processImageBuffer });
      });

      trustedHandle("appearance:read-image", async (_event, imageId) => {
        const result = await readAppearanceImage(bridge.assetsDir, String(imageId || ""));
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, bytes: result.data, mime: result.mime };
      });

      // 原生预览只覆盖窗口底色/系统材质；纯页面样式预览在渲染端完成
      trustedHandle("appearance:preview", async (_event, raw) => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
        const settings: any = bridge.resolveNormalizedSettings(raw);
        const previewTheme = settings?.theme || "system";
        nativeTheme.themeSource = (previewTheme === "system" ? "system" : previewTheme) as "system" | "dark" | "light";
        const effective = applyWindowBackdrop(mainWindow, settings as any, bridge.capabilities);
        bridge.setEffective(effective);
        const isBackdropActive = effective.applied === "vibrancy" || effective.applied === "background-material";
        mainWindow.setBackgroundColor(windowBackgroundFor(settings, bridge.resolvedTheme(settings), isBackdropActive));
        mainWindow.webContents?.invalidate?.();
        return { ok: true, effective };
      });

      trustedHandle("appearance:cancel-preview", async (_event, payload) => {
        bridge.syncThemeSource();
        bridge.applyWindow();
        // 取消时回收草稿引用过但未保存的暂存图片；已保存配置引用的绝不在此删除
        for (const id of Array.isArray(payload?.discardStaged) ? payload.discardStaged : []) {
          if (id && id !== bridge.getState().settings.background.imageId) {
            await discardStagedImage(bridge.assetsDir, String(id)).catch(() => {});
          }
        }
        return { ok: true, effective: bridge.getEffective() };
      });

      trustedHandle("appearance:reset", async () => bridge.reset());
    },
  };
}
