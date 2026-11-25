import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Verify the retained offline validator before using it. */
export async function readChartAsset(name) {
  const manifest = JSON.parse(await readFile(new URL("../../assets/chart-assets.json", import.meta.url), "utf8"));
  const expected = manifest.assets[name];
  if (!expected) throw new Error(`Unknown retained chart asset: ${name}`);
  const bytes = await readFile(new URL(`../../assets/${name}`, import.meta.url));
  if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
    throw new Error(`Retained chart asset does not match its release manifest: ${name}`);
  return bytes.toString("utf8");
}
