// setup-demo-app 技能的确定性检查：只校验可观测、可复现的事实。
// 每个检查返回 boolean 或 { pass, notes }；ctx = { result, traces, workspaceDir, targetSkill }。
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// demo 应用目录名随 prompt 变化（devday-demo / demo-app …）：找含 package.json 的一级子目录，其次工作区根
function findProjectDir(workspaceDir) {
  if (!workspaceDir || !existsSync(workspaceDir)) return "";
  for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = path.join(workspaceDir, entry.name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return existsSync(path.join(workspaceDir, "package.json")) ? workspaceDir : "";
}

export const rubricPrompt = `Evaluate the demo app in this workspace against these requirements:
- Vite + React + TypeScript project exists
- Tailwind is configured via @tailwindcss/vite and CSS imports tailwindcss
- src/components contains Header.tsx and Card.tsx
- Components are functional and styled with Tailwind utility classes (no CSS modules)
Return a rubric result as JSON with check ids: vite, tailwind, structure, style.`;

export const checks = [
  {
    id: "ran-npm-install",
    run: ({ traces }) => {
      const hit = (traces || []).some(
        (trace) =>
          trace?.kind === "tool-call" &&
          String(trace.title || "").includes("run_command") &&
          String(trace.content || "").includes("npm install"),
      );
      return { pass: hit, notes: hit ? "" : "trace 中未出现 npm install 命令" };
    },
  },
  {
    id: "has-package-json",
    run: ({ workspaceDir }) => {
      const projectDir = findProjectDir(workspaceDir);
      return { pass: Boolean(projectDir), notes: projectDir ? `project=${projectDir}` : "未找到含 package.json 的项目目录" };
    },
  },
  {
    id: "has-components",
    run: ({ workspaceDir }) => {
      const projectDir = findProjectDir(workspaceDir);
      if (!projectDir) return { pass: false, notes: "项目目录不存在" };
      const componentsDir = path.join(projectDir, "src", "components");
      const missing = ["Header.tsx", "Card.tsx"].filter((name) => !existsSync(path.join(componentsDir, name)));
      return { pass: missing.length === 0, notes: missing.length ? `缺少 ${missing.join(", ")}` : "" };
    },
  },
];
