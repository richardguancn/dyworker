import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the production Work embedding function and web app-block document
// builder. The outer iframe supplies only the sandbox's height transport.
export async function createWorkModePreview({ monorepoRoot, workspace, dependencyRequire }) {
  const { build } = await import(pathToFileURL(dependencyRequire.resolve("vite")).href);
  const output = join(workspace, "work-app-block-host");
  await build({
    root: workspace,
    configFile: false,
    cacheDir: join(workspace, ".vite-work-host"),
    logLevel: "silent",
    build: {
      outDir: output,
      emptyOutDir: false,
      target: "node22",
      minify: false,
      lib: {
        entry: join(monorepoRoot, "chatgpt/web/src/app-blocks/app-block-html-template.ts"),
        formats: ["es"],
        fileName: () => "app-block-html-template.mjs",
      },
    },
  });
  const { buildAppBlockHtmlDocument } = await import(pathToFileURL(join(output, "app-block-html-template.mjs")).href);
  const workRoot = join(monorepoRoot, "chatgpt/sa-server/sa_server/flora/system_skills/visualize");
  return async (fixture, { colorScheme = "light" } = {}) => {
    const embedded = execFileSync("python3", ["-c", `
from pathlib import Path
import runpy, sys
root = Path(sys.argv[1])
assets = root / "assets"
render = runpy.run_path(str(root / "runtime.py"))["render_embedded_visualization"]
print(render(Path(sys.argv[2]).read_text(),
    stylesheet=(assets / "visualize.css").read_text() + ":root{--chart-1:#ff00aa;--mark-radius:97}",
    calendar_runtime=(assets / "calendar.js").read_text(),
    runtime_dependencies=(assets / "runtime-dependencies.html").read_text(),
    tooltip_runtime=(assets / "tooltip-runtime.js").read_text(),
    tabs_runtime=(assets / "tabs-runtime.js").read_text(),
    carousel_runtime=(assets / "carousel-runtime.js").read_text(),
    lucide_initialization=(assets / "lucide-initialization.js").read_text(),
    before_fragment=((assets / "host-style-sync.html").read_text(),),
    after_fragment=('<style id="codex-visualization-document-overflow">html,body{overflow:hidden!important}</style>',)))
`, workRoot, fixture.metadata.path], { encoding: "utf8", maxBuffer: 4_000_000 });
    assert.ok(embedded.includes(fixture.fragment), "Work embedding must preserve the complete shared fragment");
    const { html, expectReadySignal } = buildAppBlockHtmlDocument(embedded, colorScheme, "en", "default", "inline", {
      loadTailwind: false, platform: "web", syncPresentationSurface: true,
    });
    assert.equal(expectReadySignal, false, "The shared runtime needs no external style compiler");
    const bridge = `<script>
      const report = () => parent.postMessage({ source: "work-test-height", height: Math.ceil(document.querySelector("main").getBoundingClientRect().height) }, "*");
      new ResizeObserver(report).observe(document.querySelector("main"));
      requestAnimationFrame(report);
    </script>`;
    const document = html.replace("</body>", `${bridge}</body>`);
    const path = join(workspace, `${fixture.name}-work-${colorScheme}.html`);
    await writeFile(path, `<!doctype html><html><head><meta charset="utf-8"><style>
      :root{color-scheme:${colorScheme}}body{margin:16px}iframe{display:block;width:100%;border:0}
      </style></head><body><iframe sandbox="allow-scripts" title="Work Mode chart"></iframe><script>
      const frame = document.querySelector("iframe");
      addEventListener("message", event => { if (event.source === frame.contentWindow && event.data?.source === "work-test-height") frame.style.height = event.data.height + "px"; });
      frame.srcdoc = ${JSON.stringify(document).replaceAll("<", "\\u003c")};
      </script></body></html>`);
    return path;
  };
}
