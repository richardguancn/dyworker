import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

// 渲染基准独立构建：不污染正式 vite.config.mjs，也不参与 package.json 的 build 脚本
export default defineConfig({
  root: here,
  base: "./",
  plugins: [
    // 比较旧版时替换原始 App 源码，保留相同夹具和其余依赖，不改动工作区源码。
    ...(process.env.BENCH_APP_SOURCE ? [{
      name: "bench-source-override", enforce: "pre",
      load(id) {
        if (id === path.join(projectRoot, "src/App.tsx")) return fs.readFileSync(process.env.BENCH_APP_SOURCE, "utf8");
      },
    }] : []),
    react(),
  ],
  resolve: {
    alias: {
      "@src": path.join(projectRoot, "src"),
      // 标准 production 构建里 React 不记录 profiler 时长；换官方 profiling 构建
      // （同样的生产时序，但开启 profiler 计时器）
      "react-dom/client": "react-dom/profiling",
    },
  },
  build: {
    outDir: path.join(here, process.env.BENCH_VARIANT === "before" ? "dist-before" : "dist"),
    emptyOutDir: true,
    minify: false,
    chunkSizeWarningLimit: 100000,
  },
});
