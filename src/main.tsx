import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bootstrapAppearance } from "./appearance/controller";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./appearance/appearance.css";

// 先读取并应用已保存外观（含受控 data-theme），再渲染首帧，避免启动后闪默认主题；
// 任何失败（无桥接/超时/损坏）都回落默认值继续渲染
async function start() {
  try {
    await bootstrapAppearance();
  } catch (error) {
    console.warn("外观初始化失败，使用默认外观：", error);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
