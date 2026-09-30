import os from "node:os";

// 平台能力探测。available 只表示"该平台可以尝试"，不等于效果已实际生效；
// 实际调用结果由 applyWindowBackdrop 返回，供调用方与用户选择分开记录。
export function getAppearanceCapabilities({
  platform = process.platform,
  osRelease = os.release(),
  hwAcceleration = true,
  isLinux = platform === "linux",
} = {} as any) {
  const capabilities = {
    platform: isLinux ? "linux" : platform,
    // 该平台的推荐玻璃档位：Linux 默认轻量效果
    glassDefault: isLinux ? "lightweight" : "standard",
    systemBackdrop: { available: false, kind: null, reason: null },
    backdropFilter: hwAcceleration !== false,
    backdropFilterReason: null,
  };
  if (capabilities.platform === "darwin") {
    capabilities.systemBackdrop = { available: true, kind: "vibrancy", reason: null };
  } else if (capabilities.platform === "win32") {
    const build = parseWindowsBuild(osRelease);
    if (build >= 22621) {
      capabilities.systemBackdrop = { available: true, kind: "background-material", reason: null };
    } else {
      capabilities.systemBackdrop = {
        available: false,
        kind: null,
        reason: "当前 Windows 版本不支持系统背景材质，将使用应用内效果",
      };
    }
  } else if (capabilities.platform === "linux") {
    capabilities.systemBackdrop = {
      available: false,
      kind: null,
      reason: "当前系统使用应用内玻璃效果",
    };
  }
  if (hwAcceleration === false) {
    capabilities.backdropFilter = false;
    capabilities.backdropFilterReason = "硬件加速已关闭，背景模糊等效果不可用";
  }
  return capabilities;
}

function parseWindowsBuild(osRelease) {
  const match = String(osRelease || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? Number(match[3]) : 0;
}

// 应用或撤销窗口原生背景效果。window 是 BrowserWindow 或测试桩，
// 只调用实际存在的方法（鸭子类型）。返回"实际效果状态"，与用户选择分开。
export function applyWindowBackdrop(window, appearance, capabilities) {
  const glass = appearance?.glass && typeof appearance.glass === "object" ? appearance.glass : {};
  const backdrop = capabilities?.systemBackdrop && typeof capabilities.systemBackdrop === "object"
    ? capabilities.systemBackdrop
    : { available: false, kind: null };
  const wantsBackdrop = glass.enabled === true && glass.systemBackdrop === true && backdrop.available === true;
  try {
    if (wantsBackdrop && backdrop.kind === "vibrancy" && typeof window?.setVibrancy === "function") {
      window.setVibrancy(glass.strength === "strong" ? "under-window" : "sidebar");
      return { ok: true, applied: "vibrancy" };
    }
    if (wantsBackdrop && backdrop.kind === "background-material" && typeof window?.setBackgroundMaterial === "function") {
      window.setBackgroundMaterial(glass.strength === "strong" ? "mica" : "acrylic");
      return { ok: true, applied: "background-material" };
    }
    // 未启用或平台不支持：清除之前可能设置过的系统效果。
    // 不支持的 Windows 不调用 setBackgroundMaterial（该接口仅 Windows 11 22H2+ 可用）。
    if (capabilities?.platform === "darwin" && typeof window?.setVibrancy === "function") {
      window.setVibrancy(null);
    }
    if (backdrop.kind === "background-material" && typeof window?.setBackgroundMaterial === "function") {
      window.setBackgroundMaterial("none");
    }
    return { ok: true, applied: "none" };
  } catch (error: any) {
    return { ok: false, applied: "none", reason: String(error?.message || error) };
  }
}

// 窗口启动/主题切换时的底色：优先使用用户为该主题配置的颜色，否则用应用默认底色。
// 当系统背景材质生效时，原生底色必须透明，系统桌面材质才能透入窗口。
export function windowBackgroundFor(appearance, resolvedTheme, isBackdropActive = false) {
  if (isBackdropActive) return "#00000000";
  const background = appearance?.background && typeof appearance.background === "object"
    ? appearance.background
    : {};
  const dark = resolvedTheme === "dark";
  const custom = dark ? background.darkColor : background.lightColor;
  if (typeof custom === "string" && /^#[0-9a-f]{6}$/i.test(custom)) return custom.toLowerCase();
  return dark ? "#181916" : "#f7f7f4";
}
