import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { decodeBundledResource } from "../templates/data-app/inline/resources.js";

test("inline resources decode losslessly, including Unicode and SVG URLs", async () => {
  for (const value of [":host { --font: 'Écriture'; }", "data:image/svg+xml,%3csvg%20viewBox='0 0 20 20'%3e%3c/svg%3e", ""]) {
    assert.equal(await decodeBundledResource(deflateRawSync(value).toString("base64")), value);
  }
});

test("corrupt resource data rejects rather than rendering undecoded assets", async () => {
  await assert.rejects(decodeBundledResource(Buffer.from("invalid compressed resource").toString("base64")));
});
