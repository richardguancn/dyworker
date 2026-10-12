import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 生产 CSP 在 index.html 中收紧为 script-src 'self'；开发模式下 @vitejs/plugin-react
// 会注入内联的 React Refresh 前导脚本，需临时放宽 'unsafe-inline'（仅 dev server 生效）
function devCspRelaxation() {
  return {
    name: "dev-csp-relaxation",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/,
        (_match, policy) =>
          `<meta http-equiv="Content-Security-Policy" content="${policy.replace(
            "script-src 'self'",
            "script-src 'self' 'unsafe-inline'",
          )}"`,
      );
    },
  };
}

// katex.min.css 为兼容旧浏览器同时声明 woff2/woff/ttf 三种字体格式，但 Electron 即
// Chromium，woff2 之外的两种永远不会被下载；剔除引用后 Rollup 便不再复制这 40 个字体
// 文件（约 0.9MB），公式渲染不受影响
function dropUnusedKatexFontFormats() {
  return {
    name: "drop-unused-katex-font-formats",
    enforce: "pre",
    transform(code, id) {
      if (!/katex.*\.css($|\?)/.test(id)) return null;
      const trimmed = code
        .replace(/,url\(fonts\/[^)]*\.woff\) format\("woff"\)/g, "")
        .replace(/,url\(fonts\/[^)]*\.ttf\) format\("truetype"\)/g, "");
      return trimmed === code ? null : { code: trimmed, map: null };
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // 按共享依赖分包，避免客户端插件运行时和文件编辑器挤进应用入口。
        // React 分组必须覆盖 react-dom/client 的实际模块，根入口不包含 createRoot 的实现。
        // Mermaid/ECharts 保持现有动态加载；两个编辑器共享 CodeMirror 分包。
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, "/");
          // 按实际模块路径归组，避免入口列表的递归依赖收集把 React 吸入其他分包。
          // CommonJS 公共助手与 React 放在一起，防止 React 反向依赖应用入口。
          if (moduleId.includes("commonjsHelpers") || /\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return "react";
          if (/\/node_modules\/(lexical|@lexical\/[^/]+)\//.test(moduleId)) return "draft-editor";
          if (/\/node_modules\/(@codemirror|@lezer)\//.test(moduleId)) return "codemirror";
          if (moduleId.includes("/src/pluginRuntime/") || moduleId.includes("/node_modules/@deepseek-ai/")) return "plugin-runtime";
          if (/\/node_modules\/(react-markdown|remark-[^/]+|rehype-[^/]+|highlight\.js|katex)\//.test(moduleId)) return "markdown";
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react(), devCspRelaxation(), dropUnusedKatexFontFormats()],
});
