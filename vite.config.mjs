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

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    chunkSizeWarningLimit: 2000,
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
  plugins: [react(), devCspRelaxation()],
});
