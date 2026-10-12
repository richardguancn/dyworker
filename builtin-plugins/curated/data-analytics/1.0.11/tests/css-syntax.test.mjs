import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStrictCss } from "../scripts/css-syntax.mjs";
import { loadPrebuiltCompiler } from "../scripts/data-app-runtime.mjs";
import { validateInlineThemeCss } from "../skills/visualize-data/scripts/inline-chart-theme.mjs";

let compilerPromise;
const getCompiler = () => (compilerPromise ??= loadPrebuiltCompiler());

test("strict CSS accepts complete stylesheets without imposing an inline-theme resource policy", async () => {
  const compiler = await getCompiler();
  for (const css of [
    "/* complete */ :root { --accent: light-dark(red, blue); }",
    "a { background-image: url(./approved-image.svg); }",
    '@font-face { font-family: "Local font"; src: url("./approved-font.woff2"); }',
    "@media (width >= 640px) { a { padding: calc(1rem + 2px); } }",
    String.raw`a { --escaped: "literal \\"; --bracketed: [one two]; }`,
    "a { --function: var(--other, color-mix(in srgb, red, blue)); }",
    "/**/ a { color: red } /**/",
  ]) {
    const ast = parseStrictCss(css, compiler, { filename: "authored.css" });
    assert.equal(ast.type, "StyleSheet", css);
    assert.doesNotThrow(() => parseStrictCss(compiler.generateCss(ast), compiler), css);
  }
});

test("strict CSS rejects EOF recovery, malformed syntax, Raw nodes, and incomplete comments", async () => {
  const compiler = await getCompiler();
  const malformed = [
    "a { color: red",
    "a { color: red;",
    "a { width: calc(1 + 2",
    "a { --value: [one two",
    "a { --value: (one two",
    'a { --value: "unterminated',
    String.raw`a { --value: "escaped\"`,
    String.raw`a { --value: red\}`,
    String.raw`a { --value: calc(red\)`,
    "a { background: url(approved.svg",
    'a { background: url("approved.svg")',
    "a { color: red } /* missing end",
    "a { color: red } /*/",
    "a { color red; }",
    "a { color: rgb(1, 2; }",
    "a { --value: [unclosed; }",
    "a { color: red } }",
    "a { --value: {nested:value}; }",
    "a { color: ???; }",
  ];
  for (const css of malformed) {
    assert.throws(
      () => parseStrictCss(css, compiler, { filename: "broken.css" }),
      /Invalid CSS syntax in broken\.css/iu,
      css,
    );
  }
});

test("strict CSS lets a caller explain rejection but cannot be made permissive by a callback", async () => {
  const compiler = await getCompiler();
  const seen = [];
  assert.throws(
    () =>
      parseStrictCss("a {", compiler, {
        onInvalid(error) {
          seen.push(error.message);
          throw new Error("Caller-specific CSS policy error.");
        },
      }),
    /Caller-specific CSS policy error/u,
  );
  assert.equal(seen.length, 1);
  assert.throws(() => parseStrictCss("a {", compiler, { onInvalid: () => {} }), /Invalid CSS syntax/iu);
});

test("inline resource policy validates the exact CSS emitted after comment and escape normalization", async () => {
  const compiler = await getCompiler();
  for (const css of [
    String.raw`:root { --x: u\72/**/l("https://tracker.example.test/pixel"); }`,
    String.raw`:root { --x: \000075\000072\00006c/**/("https://tracker.example.test/pixel"); }`,
    String.raw`:root { --x: var(--safe, u\72/**/l("https://tracker.example.test/pixel")); }`,
  ]) {
    const generated = compiler.generateCss(parseStrictCss(css, compiler));
    let resourceFunction = false;
    compiler.walkCss(parseStrictCss(generated, compiler), (node) => {
      if (
        node.type === "Url" ||
        (node.type === "Function" && compiler.decodeCssIdentifier(node.name).toLowerCase() === "url")
      )
        resourceFunction = true;
    });
    assert.equal(resourceFunction, true, "The fixture must exercise the changed token boundary.");
    assert.throws(() => validateInlineThemeCss(css, compiler), /Custom inline themes/iu, css);
  }
});
