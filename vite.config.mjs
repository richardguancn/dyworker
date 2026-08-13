import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    rollupOptions: {
      output: {
        // 按依赖族拆分 vendor：单 chunk 超 500 kB 会拖慢打包后首次解析（Electron 本地加载虽然不吃网络，
        // 但 700+ kB 的单个 JS 仍要一次性 parse），拆开后主 chunk 只剩应用代码
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (id.includes("node_modules/highlight.js")) return "vendor-highlight";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          // react-markdown / remark / micromark / unified 一族与其余零散依赖
          return "vendor";
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
  plugins: [react()],
});
