import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// mermaid 的整棵依赖树（含 cytoscape/d3/dagre/elkjs 等传递依赖，约 2.5MB）必须留在
// 动态 import 的懒加载 chunk：manualChunks 若把它们兜底归入 vendor，会被静态引用的
// vendor 合并成 eager 加载，首次解析直接多出 ~2.5MB。这里在构建期从 node_modules
// 实际读取依赖闭包，避免手工维护包名清单。
const require = createRequire(import.meta.url);
const mermaidDeps = (() => {
  const seen = new Set();
  const queue = ["mermaid"];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    let manifestPath;
    try {
      manifestPath = require.resolve(`${name}/package.json`);
    } catch {
      continue;
    }
    const dependencies = JSON.parse(readFileSync(manifestPath, "utf8")).dependencies || {};
    for (const dependency of Object.keys(dependencies)) queue.push(dependency);
  }
  return seen;
})();

// 从模块 id 提取 node_modules 里的包名（兼容 @scope/name 形式）
function packageNameOf(id) {
  const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/);
  return match ? match[1] : "";
}

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/client",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 按依赖族拆分 vendor：单 chunk 超 500 kB 会拖慢打包后首次解析（Electron 本地加载虽然不吃网络，
        // 但 700+ kB 的单个 JS 仍要一次性 parse），拆开后主 chunk 只剩应用代码
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // mermaid 及其依赖闭包不归入任何手动 chunk，保持动态 import 懒加载
          if (mermaidDeps.has(packageNameOf(id))) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (id.includes("node_modules/highlight.js")) return "vendor-highlight";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          // react-markdown / remark / micromark / unified 一族与其余零散依赖统一归入 vendor，避免循环依赖
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
