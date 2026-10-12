// 「左侧栏与正文区共用一个底色」的契约（用户实报：左右区域背景要统一）。
//
// 两侧底色其实来自不同变量（侧栏 --sidebar、正文 --surface），所以必须钉住三件事：
// 1) 默认值里 --sidebar 与 --surface 同色（浅色、深色两套都要）；
// 2) 深色态正文区顶部那条提亮渐变，左侧栏也要吃到，否则顶部会露出两块色；
// 3) 自定义背景色/透明度/玻璃时，派生出来的 --sidebar 必须与 --surface 完全相同，
//    否则一旦用户开了外观自定义，左右两块底又分家了。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DARK_DEFAULTS, LIGHT_DEFAULTS, derivePalette } from "../src/appearance/tokens.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const styles = read("../src/styles.css");
const layout = read("../src/layout.css");
const appearance = read("../src/appearance/appearance.css");

/** 取某个规则体里的某个变量值（源码文本层面，够用且不依赖 CSS 解析器） */
function varIn(block, name) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  return match ? match[1].trim() : null;
}

test("默认色板：侧栏底色与正文底色同值（浅色 + 深色）", () => {
  const lightLayout = layout.slice(layout.indexOf(":root {"), layout.indexOf("}", layout.indexOf(":root {")));
  assert.equal(varIn(lightLayout, "--sidebar"), varIn(lightLayout, "--surface"),
    "layout.css 里浅色 --sidebar 必须等于 --surface");

  const lightStyles = styles.slice(styles.indexOf(":root {"), styles.indexOf("}", styles.indexOf(":root {")));
  assert.equal(varIn(lightStyles, "--sidebar"), varIn(lightStyles, "--surface"),
    "styles.css 里浅色 --sidebar 必须等于 --surface");

  const darkBlocks = [...styles.matchAll(/html\[data-theme="dark"\] \{[\s\S]*?\n  \}|html:not\(\[data-theme\]\) \{[\s\S]*?\n  \}/g)]
    .filter((match) => varIn(match[0], "--sidebar"));
  assert.ok(darkBlocks.length >= 2, `深色变量块应有 2 处（data-theme 与无主题），实际 ${darkBlocks.length}`);
  for (const block of darkBlocks) {
    assert.equal(varIn(block[0], "--sidebar"), varIn(block[0], "--surface"),
      "深色 --sidebar 必须等于 --surface");
  }
});

test("深色顶部提亮与透出模式：左侧栏跟正文区走同一套底", () => {
  for (const theme of ['html[data-theme="dark"]', "html:not([data-theme])"]) {
    const rule = new RegExp(`${theme.replace(/[[\]"()]/g, (c) => `\\${c}`)} \\.reference-layout \\.sidebar \\{[^}]*background:\\s*linear-gradient\\(180deg, #1b1c19 0%, var\\(--surface\\) 180px\\)`);
    assert.match(styles, rule, `${theme} 下左侧栏要跟正文区一样带顶部提亮`);
  }
  assert.match(
    appearance,
    /html\[data-translucent="true"\] \.reference-layout \.sidebar \{[^}]*background:\s*var\(--sidebar\)/,
    "透出模式下左侧栏要用面板材质，不能被深色那条不透明渐变盖住",
  );
});

test("自定义背景色/透明度/玻璃：派生出的侧栏色与正文色完全一致", () => {
  assert.equal(LIGHT_DEFAULTS.sidebar, LIGHT_DEFAULTS.surface, "浅色默认值要同色");
  assert.equal(DARK_DEFAULTS.sidebar, DARK_DEFAULTS.surface, "深色默认值要同色");

  for (const resolved of ["light", "dark"]) {
    const themed = (color, transparency) => ({
      background: {
        lightColor: resolved === "light" ? color : null,
        darkColor: resolved === "dark" ? color : null,
        transparency, imageId: null, imageFit: "cover", overlay: 20,
      },
    });
    const cases = [themed("#3a2f6b", 0), themed(null, 35), themed("#2f5d50", 20)];
    for (const settings of cases) {
      for (const glass of [false, true]) {
        const palette = derivePalette(settings, resolved, { glass });
        assert.ok(palette, `${resolved} / ${JSON.stringify(settings.background)} / glass=${glass} 应派生出面板色`);
        assert.equal(palette["--sidebar"], palette["--surface"],
          `派生的侧栏色必须等于正文色（${resolved} / glass=${glass} / ${JSON.stringify(settings.background)}）`);
      }
    }
  }
});
