import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Build inputs only. Installed checks consume the verified bundled copies. */
export function readDataAppTypeSources(pluginRoot) {
  return Object.fromEntries([
    ["data-app-public.d.ts", "output_formats/html/scripts/types/data-app-public.d.ts"],
    ["chart-spec.d.ts", "output_formats/html/scripts/types/chart-spec.d.ts"],
    ["react-style.d.ts", "output_formats/html/scripts/types/react-style.d.ts"],
    ["react-dom.d.ts", "output_formats/html/scripts/types/react-dom.d.ts"],
    ["react-dom-client.d.ts", "output_formats/html/scripts/types/react-dom-client.d.ts"],
    ["react-markdown.d.ts", "output_formats/html/scripts/types/react-markdown.d.ts"],
    ["canonical-chart.d.ts", "skills/visualize-data/src/public-api.d.ts"],
    ...readdirSync(join(pluginRoot, "skills/visualize-data/src/types"))
      .filter((name) => name.endsWith(".d.ts"))
      .sort()
      .map((name) => [`types/${name}`, `skills/visualize-data/src/types/${name}`]),
  ].map(([name, path]) => [name, readFileSync(join(pluginRoot, path), "utf8")]));
}
