import assert from "node:assert/strict";
import test from "node:test";

import { assertNoPublicationSecrets } from "../skills/publish-artifact-to-sites/scripts/publication-secrets.mjs";

const inspect = (overrides) =>
  assertNoPublicationSecrets({
    html: "<main>Reviewed dashboard</main>",
    seedSnapshot: { queries: {} },
    initialPresentation: {},
    ...overrides,
  });
const disclosure = /Publication contains a possible credential/u;
const encodings = ["base64", "percent"];
const inlineJson = (json, encoding) => ({
  html: encoding === "base64"
    ? `data:application/json;base64,${Buffer.from(json).toString("base64")}`
    : `data:application/json,${encodeURIComponent(json)}`,
});

test("valid deep inline JSON fails closed instead of falling back to unstructured text", () => {
  const json = '{"level":'.repeat(256) + '{"token":"INERT_TEST_VALUE"}' + "}".repeat(256);
  assert.doesNotThrow(() => JSON.parse(json));
  for (const encoding of encodings) {
    assert.throws(
      () => inspect(inlineJson(json, encoding)),
      /Publication (?:contains a possible credential|exceeds the supported credential scan limits)/u,
      encoding,
    );
  }
});

test("seven encoded wrappers preserve callback code scope after path and fragment normalization", () => {
  for (const callback of ["https://app.example/%63allback", "https://app.example/report#%2Fcallback"]) {
    for (const code of ["", "INERT_TEST_VALUE"]) {
      let url = `${callback}?code=${code}&state=reviewed`;
      for (let depth = 0; depth < 7; depth += 1) {
        url = `https://outer.test/report?next=${encodeURIComponent(url)}&code=US&state=CA`;
      }
      const input = { seedSnapshot: { source: { url } } };
      if (code) assert.throws(() => inspect(input), disclosure, callback);
      else assert.equal(inspect(input).complete, true, callback);
    }
  }
});

test("valid inline JSON numbers and whitespace preserve escaped metadata-key checks", () => {
  for (const number of ["-0", "0.125", "1E+2", "1e-2"]) {
    const json = ` \t\r\n{"\\u0074oken":"INERT_CATEGORY","value":${number}}\r\n`;
    assert.doesNotThrow(() => JSON.parse(json));
    for (const encoding of encodings) {
      assert.throws(() => inspect(inlineJson(json, encoding)), disclosure, `${number}/${encoding}`);
    }
  }
});

test("invalid inline JSON is not partly interpreted as credential metadata", () => {
  const prefix = '{"\\u0074oken":"INERT_CATEGORY"';
  const fixtures = [
    `${prefix},"value":01}`,
    `${prefix},"value":1e+}`,
    `${prefix},"value":NaN}`,
    `${prefix},"value":"\\x41"}`,
    `${prefix}}{}`,
    `${prefix}`,
    `\u00a0${prefix}}`,
  ];
  for (const json of fixtures) {
    assert.throws(() => JSON.parse(json), SyntaxError);
    for (const encoding of encodings) {
      assert.equal(inspect(inlineJson(json, encoding)).complete, true, encoding);
    }
  }
});

test("invalid inline JSON still receives literal credential inspection", () => {
  const json = '{"value":"Bearer INERT_TEST_BEARER_VALUE_1234567890"';
  assert.throws(() => JSON.parse(json), SyntaxError);
  for (const encoding of encodings) {
    assert.throws(() => inspect(inlineJson(json, encoding)), disclosure, encoding);
  }
});

test("overwritten ancestor properties cannot hide credentials physically present in inline JSON", () => {
  const fixtures = [
    '{"source":{"token":"INERT_CATEGORY"},"source":{}}',
    '{"source":[{"token":"INERT_CATEGORY"}],"source":null}',
    '{"sour\\u0063e":{"token":"INERT_CATEGORY"},"source":{}}',
  ];
  for (const json of fixtures) {
    // This is intentionally stricter than scanning JSON.parse's final object:
    // the overwritten credential-bearing value remains in the uploaded bytes.
    assert.equal(inspect({ seedSnapshot: JSON.parse(json) }).complete, true);
    for (const encoding of encodings) {
      assert.throws(() => inspect(inlineJson(json, encoding)), disclosure, encoding);
    }
  }
});
