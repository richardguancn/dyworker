import { existsSync } from "node:fs";
import { join } from "node:path";

export function chartRuntimePath(pluginRoot, name = "") {
  const source = join(pluginRoot, "skills/visualize-data");
  const root = existsSync(join(source, "src/ChartRenderer.jsx")) ? source : join(pluginRoot, "assets/visualize-data");
  return join(root, name);
}
