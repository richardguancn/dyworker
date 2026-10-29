import path from "node:path";

// macOS Dock 图标独立于界面主题；保留用户手动选择并复用现有深色原图。
export function createDockIconController({ platform, directory, nativeImage, getDock, warn = console.warn }) {
  const images = new Map();
  let applied;
  return {
    apply(choice) {
      if (platform !== "darwin") return false;
      const name = choice === "light" ? "light" : "dark";
      if (applied === name) return true;
      try {
        const dock = getDock?.();
        if (!dock) return false;
        if (!images.has(name)) {
          const file = `dock-${name}.png`;
          const image = nativeImage.createFromPath(path.join(directory, file));
          if (image.isEmpty()) { warn(`[dyworker] 无法读取 ${name} Dock 图标`); return false; }
          images.set(name, image);
        }
        dock.setIcon(images.get(name));
        applied = name;
        return true;
      } catch (error) {
        warn("[dyworker] 更新 Dock 图标失败", error);
        return false;
      }
    },
  };
}

// Windows/Linux 窗口图标与启动器、固定快捷方式由不同入口管理。
// 运行中的窗口沿用 dockIcon 保存的独立选择，不随界面主题切换。
export function createWindowIconController({ platform, directory, nativeImage, warn = console.warn }) {
  const images = new Map();
  const applied = new WeakMap();
  const iconFor = (choice) => {
    const name = choice === "light" ? "light" : "dark";
    if (!images.has(name)) {
      const image = nativeImage.createFromPath(path.join(directory, `icon-${name}.png`));
      if (image.isEmpty()) {
        warn(`[dyworker] 无法读取 ${name} 窗口图标`);
        return undefined;
      }
      images.set(name, image);
    }
    return images.get(name);
  };
  return {
    iconFor,
    apply(window, choice) {
      if (!["linux", "win32"].includes(platform) || !window || window.isDestroyed()) return false;
      const name = choice === "light" ? "light" : "dark";
      if (applied.get(window) === name) return true;
      try {
        const icon = iconFor(name);
        if (!icon) return false;
        window.setIcon(icon);
        applied.set(window, name);
        return true;
      } catch (error) {
        warn("[dyworker] 更新窗口图标失败", error);
        return false;
      }
    },
  };
}
