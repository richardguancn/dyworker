import test from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOP_AUTO_FIT_WIDTH,
  MAX_VIEWPORT_SIZE,
  MIN_VIEWPORT_SIZE,
  computeAutoFitZoomFactor,
  computeResizedViewport,
  computeStageViewportLayout,
  createDefaultBrowserViewport,
} from "../src/features/browser/browserViewport.ts";

test("computeAutoFitZoomFactor: 窄窗口自动缩小适配桌面逻辑宽度并支持叠加手动缩放", () => {
  // 宽窗口不缩小，保持 1.0
  assert.equal(computeAutoFitZoomFactor(1200, 0, true), 1);

  // 窄窗口（512px -> 1024px 的 0.5）
  assert.equal(computeAutoFitZoomFactor(512, 0, true), 512 / DESKTOP_AUTO_FIT_WIDTH);

  // 极窄窗口（150px）夹取下限 0.25
  assert.equal(computeAutoFitZoomFactor(150, 0, true), 0.25);

  // 关闭自动适配时不缩小
  assert.equal(computeAutoFitZoomFactor(360, 0, false), 1);

  // 窄窗口叠加手动放大 1 档（0.5 * 1.2 = 0.6）
  const combined = computeAutoFitZoomFactor(512, 1, true);
  assert.ok(Math.abs(combined - 0.6) < 1e-6);

  // 手动连续放大夹取上限 3.0
  assert.equal(computeAutoFitZoomFactor(1200, 10, true), 3);
});

test("computeStageViewportLayout: 自动适应与固定缩放布局计算准确", () => {
  const def = createDefaultBrowserViewport();
  assert.deepEqual(def, {
    open: true,
    preset: "responsive",
    width: 1024,
    height: 720,
    zoomMode: "auto",
    mobile: false,
  });

  // 容器宽度不足时（例如 528 - 48 = 480px 可用宽度），1024 宽度按 480/1024 缩放
  const narrow = computeStageViewportLayout({ width: 1024, height: 720, zoomMode: "auto" }, 528, 700);
  assert.ok(Math.abs(narrow.scale - 480 / 1024) < 1e-6);
  assert.equal(narrow.displayWidth, 480);
  assert.equal(narrow.displayHeight, Math.round(720 * (480 / 1024)));
  assert.equal(narrow.zoomPercent, Math.round((480 / 1024) * 100));

  // 容器足够大时不超出 100% 自动放大
  const spacious = computeStageViewportLayout({ width: 390, height: 844, zoomMode: "auto" }, 1200, 1000);
  assert.equal(spacious.scale, 1);
  assert.equal(spacious.displayWidth, 390);
  assert.equal(spacious.displayHeight, 844);
  assert.equal(spacious.zoomPercent, 100);

  // 固定百分比（如 Codex 截图里的 67%）
  const fixed = computeStageViewportLayout({ width: 240, height: 647, zoomMode: 0.67 }, 800, 800);
  assert.equal(fixed.scale, 0.67);
  assert.equal(fixed.displayWidth, Math.round(240 * 0.67));
  assert.equal(fixed.displayHeight, Math.round(647 * 0.67));
  assert.equal(fixed.zoomPercent, 67);
});

test("computeResizedViewport: 5 个方向拖拽计算与尺寸上下限夹取", () => {
  const start = { width: 600, height: 800 };

  // 右侧手柄向右拖 30px（scale=0.5，居中布局加倍 => +120）
  assert.deepEqual(computeResizedViewport(start, "right", 30, 40, 0.5), { width: 720, height: 800 });

  // 左侧手柄向左拖 -30px（scale=0.5 => 宽 +120）
  assert.deepEqual(computeResizedViewport(start, "left", -30, 40, 0.5), { width: 720, height: 800 });

  // 底部手柄向下拖 50px（scale=0.5 => 高 +100，宽不变）
  assert.deepEqual(computeResizedViewport(start, "bottom", 99, 50, 0.5), { width: 600, height: 900 });

  // 左下角同时改宽高
  assert.deepEqual(computeResizedViewport(start, "bottom-left", 25, -40, 1), { width: 550, height: 760 });

  // 右下角同时改宽高
  assert.deepEqual(computeResizedViewport(start, "bottom-right", 40, 60, 1), { width: 680, height: 860 });

  // 边界夹取 [200, 3840]
  assert.deepEqual(computeResizedViewport(start, "bottom-right", -5000, -5000, 1), {
    width: MIN_VIEWPORT_SIZE,
    height: MIN_VIEWPORT_SIZE,
  });
  assert.deepEqual(computeResizedViewport(start, "bottom-right", 5000, 5000, 1), {
    width: MAX_VIEWPORT_SIZE,
    height: MAX_VIEWPORT_SIZE,
  });
});
