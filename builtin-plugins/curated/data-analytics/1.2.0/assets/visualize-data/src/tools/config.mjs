import { readChartAsset } from "./assets.mjs";

await readChartAsset("chart-check.mjs");
const { checkedChartConfig } = await import("../../assets/chart-check.mjs");

export const PAGE_MAX_BYTES = 256 * 1024;
export const INLINE_MAX_BYTES = 1_000_000;

/** Use the same non-mutating validation as the pinned browser runtime. */
export function validateChartConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Chart configuration must be an object.");
  if (Buffer.byteLength(JSON.stringify(value)) > 2_000_000)
    throw new Error("Chart input exceeds 2 MB; use a reviewed reduction.");
  return checkedChartConfig(value);
}

export function inlineJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("$", "\\u0024")
    .replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
