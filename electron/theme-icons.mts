import path from "node:path";

// Linux 窗口图标与桌面启动器图标由不同入口管理；这里只更新运行中的窗口。
export function createWindowIconController({ platform, directory, nativeImage, warn = console.warn }) {
  const images = new Map();
  const applied = new WeakMap();
  const iconFor = (theme) => {
    const name = theme === "dark" ? "dark" : "light";
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
    apply(window, theme) {
      if (platform !== "linux" || !window || window.isDestroyed()) return false;
      const name = theme === "dark" ? "dark" : "light";
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
