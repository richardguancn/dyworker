import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { renderChart } from "./render.mjs";

/** Capture the same pinned CDN chart used by inline answers and Pages. */
export async function exportChart(config, { page, output, width = 960, appearance = "light" }) {
  const { html, charts } = await renderChart(config, { surface: "html", appearance });
  const cdn = JSON.parse(await readFile(new URL("../../assets/cdn.json", import.meta.url), "utf8"));
  const errors = [], requests = [], blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = route.request().url();
    requests.push(url);
    if (url.startsWith(cdn.baseUrl)) return route.fallback();
    blocked.push(url);
    return route.abort();
  });
  await page.addInitScript(() => {
    globalThis.openai = { callTool(name) {
      if (name === "__codex_inline_visualization_ready__") globalThis.__dataChartReady = true;
    } };
  });
  await page.goto("about:blank");
  await page.setContent(html, { waitUntil: "load" });
  await Promise.race([
    page.waitForFunction(() => globalThis.__dataChartReady === true, null, { timeout: 15000 }),
    page.getByRole("alert").first().waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => { throw new Error(`Chart export failed: ${errors.join("; ") || "the CDN chart did not become ready"}`); });
  if (errors.length || await page.getByRole("alert").count())
    throw new Error(`Chart export failed: ${errors.join("; ") || await page.getByRole("alert").first().innerText()}`);
  if (blocked.length) throw new Error("Chart export requested resources outside the pinned CDN release.");
  if (await page.locator("[data-chart-root]").count() !== charts)
    throw new Error("Export did not render every requested chart.");
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(output), { recursive: true });
  await page.locator("[data-data-chart]").screenshot({ path: output, animations: "disabled" });
  return { path: output, charts, width, scale: 2, rendering: "checked", networkRequests: requests.length, reference: `![${config.title ?? "Chart comparison"}](${output})` };
}
