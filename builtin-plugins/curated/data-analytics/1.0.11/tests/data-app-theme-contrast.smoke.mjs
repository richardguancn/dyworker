import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import {
  chromeContrastRatio,
  compositeChromeColor,
  parseChromeColor,
} from "../templates/data-app/base/src/chrome-contrast.js";
import { resolveChromiumExecutable, runDataAppFixtureBuild } from "./browser-helpers.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(pluginRoot, "templates/data-app/base");
const workspace = mkdtempSync(join(tmpdir(), "data-app-theme-contrast-"));
const themes = [
  {
    id: "cobalt-dark-ink",
    surface: "dashboard",
    background: "#1538d4",
    foreground: "#06115f",
    secondary: "#46518a",
    page: "#f7f7f4",
    radius: "0",
    font: "Georgia, serif",
  },
  {
    id: "forest-near-invisible",
    surface: "dashboard",
    background: "#173e2f",
    foreground: "#153b2d",
    secondary: "#5d6f61",
    page: "#f5f0e4",
    radius: "2px",
    font: "Georgia, serif",
  },
  {
    id: "navy-editorial",
    surface: "report",
    background: "#193349",
    foreground: "#f8edda",
    secondary: "#536477",
    page: "#f3ead8",
    radius: "2px",
    font: "Georgia, serif",
  },
  {
    id: "pale-low-contrast",
    surface: "report",
    background: "#e5ecdc",
    foreground: "#d7decf",
    secondary: "#c0c4b7",
    page: "#f5f0e4",
    radius: "3px",
    font: "Courier New, monospace",
  },
  {
    id: "midnight-square-controls",
    surface: "dashboard",
    background: "#060811",
    foreground: "#edf7ff",
    secondary: "#1c2333",
    page: "#060811",
    radius: "0",
    font: "Courier New, monospace",
  },
  {
    id: "coherent-whole-dashboard-dark",
    surface: "dashboard",
    background: "#080b12",
    foreground: "#f4f7fb",
    secondary: "#93a0b7",
    page: "#080b12",
    control: "#151b28",
    radius: "10px",
    font: "Georgia, serif",
    coherent: true,
  },
  {
    id: "light-controls-inside-dark-filter-region",
    surface: "dashboard",
    background: "#ffffff",
    foreground: "#1a1c1f",
    secondary: "#646464",
    page: "#ffffff",
    control: "#ffffff",
    radius: "10px",
    font: "Georgia, serif",
    inherited: "#f3f7ff",
  },
];

function assertContrast(name, foreground, background, minimum = 4.5) {
  const ratio = chromeContrastRatio(parseChromeColor(foreground), parseChromeColor(background));
  assert.ok(ratio >= minimum, `${name} contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1`);
  return Number(ratio.toFixed(2));
}

const browser = await chromium.launch({
  executablePath: resolveChromiumExecutable(),
  headless: true,
});
const results = [];

try {
  for (const theme of themes) {
    const project = join(workspace, theme.id);
    cpSync(template, project, {
      recursive: true,
      filter: (path) => !path.includes("/node_modules") && !path.includes("/dist"),
    });
    const dataPath = join(project, "src/data.json");
    const snapshot = JSON.parse(readFileSync(dataPath, "utf8"));
    snapshot.surface = theme.surface;
    writeFileSync(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const themePath = join(project, "src/theme.css");
    writeFileSync(
      themePath,
      `${readFileSync(themePath, "utf8")}\n:root {\n` +
        `  --background: ${theme.page};\n` +
        `  --text: ${theme.foreground};\n` +
        `  --secondary: ${theme.secondary};\n` +
        (theme.control ? `  --control: ${theme.control};\n` : "") +
        `  --control-radius: ${theme.radius};\n` +
        `  --font-sans: ${theme.font};\n` +
        `  --data-app-chrome-background: ${theme.background};\n` +
        `  --data-app-chrome-text: ${theme.foreground};\n}\n`,
    );
    if (theme.inherited) {
      const contentStyles = join(project, "src/content/dashboard/dashboard.css");
      writeFileSync(
        contentStyles,
        `${readFileSync(contentStyles, "utf8")}\n` +
          `.filter-bar { color: ${theme.inherited}; background: #0b1220; }\n`,
      );
    }
    const build = runDataAppFixtureBuild(project, { pluginRoot });
    assert.equal(build.status, 0, `${theme.id}: ${build.stdout}\n${build.stderr}`);

    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await page.goto(pathToFileURL(join(project, "dist/index.html")).href, {
      waitUntil: "load",
    });
    await page.locator(".dashboard-topbar-title").waitFor();
    const measured = await page.locator('[data-data-app-chrome="topbar"]').evaluate((header) => {
      const get = (selector) => {
        const element = header.querySelector(selector);
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return {
          color: style.color,
          background: style.backgroundColor,
          radius: style.borderRadius,
          width: bounds.width,
          height: bounds.height,
          font: style.fontFamily,
          x: bounds.x,
          y: bounds.y,
        };
      };
      return {
        background: getComputedStyle(header).backgroundColor,
        underlay: getComputedStyle(document.body).backgroundColor,
        title: get(".dashboard-topbar-title"),
        freshness: get(".freshness"),
        action: get(".dashboard-header-action-button"),
        overflow: get(".dashboard-header-overflow-button"),
        publish: get(".dashboard-publish-button"),
        toggle: get(".topbar-mode-switcher"),
        indicator: get(".topbar-mode-indicator"),
        selected: get('.topbar-mode-switcher button[aria-pressed="true"]'),
        unselected: get('.topbar-mode-switcher button[aria-pressed="false"]'),
      };
    });
    const actualBackground = compositeChromeColor(
      parseChromeColor(measured.background),
      parseChromeColor(measured.underlay),
    );
    const background = `rgb(${actualBackground.slice(0, 3).join(", ")})`;
    const contrast = {};
    for (const item of ["title", "freshness", "action", "overflow"]) {
      contrast[item] = assertContrast(`${theme.id} ${item}`, measured[item].color, background);
    }
    contrast.publish = assertContrast(`${theme.id} Publish`, measured.publish.color, measured.publish.background);
    contrast.publishAgainstHeader = assertContrast(
      `${theme.id} Publish surface`,
      measured.publish.background,
      background,
    );
    contrast.selected = assertContrast(
      `${theme.id} selected icon`,
      measured.selected.color,
      measured.indicator.background,
    );
    contrast.unselected = assertContrast(
      `${theme.id} unselected icon`,
      measured.unselected.color,
      measured.toggle.background,
    );

    if (theme.control) {
      const filters = await page.locator(".filter-trigger").evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button);
          const label = button.querySelector(".filter-label");
          return {
            color: style.color,
            background: style.backgroundColor,
            label: label ? getComputedStyle(label).color : style.color,
          };
        }),
      );
      assert.ok(filters.length > 0, `${theme.id} did not render shared filter controls`);
      filters.forEach((filter, index) => {
        contrast[`filter${index}Value`] = assertContrast(`${theme.id} filter value`, filter.color, filter.background);
        contrast[`filter${index}Label`] = assertContrast(`${theme.id} filter label`, filter.label, filter.background);
      });
    }
    if (theme.coherent) {
      const surfaces = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        header: getComputedStyle(document.querySelector(".dashboard-topbar")).backgroundColor,
        main: getComputedStyle(document.querySelector("main")).backgroundColor,
      }));
      const body = parseChromeColor(surfaces.body);
      const header = compositeChromeColor(parseChromeColor(surfaces.header), body);
      const main = compositeChromeColor(parseChromeColor(surfaces.main), body);
      assert.ok(
        chromeContrastRatio(body, header) < 1.5,
        `${theme.id} disconnected protected chrome from the authored dark theme`,
      );
      assert.ok(
        chromeContrastRatio(body, main) < 1.5,
        `${theme.id} left contrasting page gutters around the authored dark theme`,
      );
    }

    assert.deepEqual(
      [measured.toggle.width, measured.toggle.height],
      [84, 32],
      `${theme.id} changed the protected segmented-control geometry`,
    );
    assert.deepEqual([measured.indicator.width, measured.indicator.height], [40, 28]);
    for (const [item, radius] of Object.entries({
      toggle: "12px", indicator: "10px", selected: "10px", unselected: "10px", publish: "12px",
    })) {
      assert.equal(measured[item].radius, radius, `${theme.id} distorted the protected ${item} button shape`);
    }
    for (const item of ["title", "publish", "selected", "unselected", "action"]) {
      assert.match(measured[item].font, /(?:-apple-system|system-ui)/u,
        `${theme.id} should preserve the protected host/system font for ${item}`);
      assert.doesNotMatch(measured[item].font, /OpenAI Sans|Georgia|Courier New/u,
        `${theme.id} leaked custom authored typography into protected ${item}`);
    }
    await page.getByRole("button", { name: "Edit mode" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.topbar-mode-switcher button[aria-label="Edit mode"]')?.getAttribute("aria-pressed") ===
        "true",
    );
    await page.waitForFunction(() => {
      const track = document.querySelector(".topbar-mode-switcher");
      const indicator = track?.querySelector(".topbar-mode-indicator");
      return indicator && indicator.getBoundingClientRect().left - track.getBoundingClientRect().left >= 41.9;
    });
    const geometry = await page.locator(".topbar-mode-switcher").evaluate((track) => {
      const outer = track.getBoundingClientRect();
      const indicator = track.querySelector(".topbar-mode-indicator").getBoundingClientRect();
      return {
        left: indicator.left - outer.left,
        right: outer.right - indicator.right,
        top: indicator.top - outer.top,
        bottom: outer.bottom - indicator.bottom,
      };
    });
    for (const [side, expected] of Object.entries({
      left: 42,
      right: 2,
      top: 2,
      bottom: 2,
    })) {
      assert.ok(
        Math.abs(geometry[side] - expected) <= 0.15,
        `${theme.id} clips or misaligns the selected edit-mode indicator: ${JSON.stringify(geometry)}`,
      );
    }
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit theme" }).waitFor();
    results.push({ id: theme.id, surface: theme.surface, contrast, geometry });
    await page.close();
  }
} finally {
  await browser.close();
  rmSync(workspace, { recursive: true, force: true });
}

console.log(JSON.stringify({ status: "passed", themes: results }, null, 2));
