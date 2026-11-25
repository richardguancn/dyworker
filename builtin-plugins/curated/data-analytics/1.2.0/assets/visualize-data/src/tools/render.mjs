import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateChartConfig, inlineJson, INLINE_MAX_BYTES, PAGE_MAX_BYTES } from "./config.mjs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
export const escapeHtml = value => String(value).replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** One portable chart contract for native inline, Page embeds and HTML reports. */
export async function renderChart(config, { surface = "inline", appearance = "auto", offline = false } = {}) {
  if (!["inline", "page", "html"].includes(surface)) throw new Error("Choose inline, page, or html.");
  if (!["auto", "light", "dark"].includes(appearance)) throw new Error("Choose auto, light, or dark appearance.");
  if (offline) throw new Error("Charts use the pinned CDN. Export an image for offline viewing.");
  const reviewed = validateChartConfig(config);
  const pin = JSON.parse(await read("../../assets/cdn.json"));
  const json = inlineJson(config);
  // Separate embeds can intentionally show the same reviewed chart.
  const id = `data-chart-${randomUUID()}`;
  const css = await read("../../assets/chart-host.css");
  const entry = new URL(pin.element, pin.baseUrl).href;
  const height = Math.max(...(reviewed.charts ?? [reviewed]).map(chart => chart.height ?? 280)) + 100;
  // A fragment may also be served as its own file without an HTTP charset.
  // Keep this before non-ASCII text, within the browser's encoding prescan.
  // Keep config in its executable module; streaming hosts may relocate scripts.
  const fragment = `<meta charset="utf-8"><style>${css}</style>
<section id="${id}" data-data-chart data-viz-composition data-appearance="${appearance}">
<div data-viz-container style="min-width:0;min-height:${height}px"></div>
</section>
<script type="module">
const {mountChart}=await import(${JSON.stringify(entry)});
const root=document.getElementById(${JSON.stringify(id)});
const target=root.querySelector("[data-viz-container]");
const config=${json};
mountChart(target,config);
</script>`;
  const title = config.title ?? "Chart comparison";
  const html = surface === "html" ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>html,body{margin:0}body{padding:20px;background:light-dark(#fff,#202020);color-scheme:light dark}</style></head><body>${fragment}</body></html>` : fragment;
  const bytes = Buffer.byteLength(html);
  const limit = surface === "page" ? PAGE_MAX_BYTES : INLINE_MAX_BYTES;
  if (bytes > limit) throw new Error(`Chart is ${bytes} UTF-8 bytes; ${surface} permits ${limit}. Reduce reviewed data explicitly or export an image.`);
  return { html, bytes, surface, offline: false, chartApiVersion: pin.chartApiVersion, charts: reviewed.charts?.length ?? 1, title };
}
