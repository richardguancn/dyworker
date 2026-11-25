import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Charts have their own release archive; these components ship in the app runtime.
export const UI_COMPONENT_GROUPS = Object.freeze(["controls", "tables", "metrics", "layout", "primitives"]);

export function uiComponentFiles(pluginRoot) {
  const files = [];
  function visit(name) {
    const path = join(pluginRoot, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`UI component source cannot contain symlinks: ${name}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(`${name}/${entry}`);
    } else if (stat.isFile()) files.push(name);
    else throw new Error(`Unsupported UI component source: ${name}`);
  }
  for (const group of UI_COMPONENT_GROUPS) visit(`output_formats/html/src/ui/${group}`);
  return files.sort();
}
