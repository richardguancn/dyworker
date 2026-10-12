import assert from "node:assert/strict";
import test from "node:test";

import { assertNoPublicationSecrets } from "../skills/publish-artifact-to-sites/scripts/publication-secrets.mjs";
import {
  createInlineDataScanner,
  createJsonMetadataScanner,
  createLiteralScanner,
  MAX_DEPTH,
  TEXT_WINDOW,
} from "../skills/publish-artifact-to-sites/scripts/publication-scan-streams.mjs";

const disclosure = /synthetic credential rejected/u;
const reject = () => { throw new Error("synthetic credential rejected"); };
const limit = () => { throw new Error("depth limit"); };
const credentialKey = (key, scope) => key === "apikey" || (scope !== "rows" && /^(?:token|secret)$/u.test(key));
const credential = "sk-proj-" + "a".repeat(24);

function harness({ inline = true, ...options } = {}) {
  const stats = { maxWrite: 0, decoded: 0, assets: 0, maxDepth: 0 };
  const createTextScanner = () => {
    const scanner = createLiteralScanner(reject);
    return {
      write(text) { stats.maxWrite = Math.max(stats.maxWrite, text.length); scanner.write(text); },
      finish() { scanner.finish(); },
    };
  };
  const common = { createTextScanner, credentialKey, reject, limit, depthChanged: (depth) => { stats.maxDepth = Math.max(stats.maxDepth, depth); } };
  const createInline = () => createInlineDataScanner({
    createTextScanner,
    createJsonScanner: () => createJsonMetadataScanner(common),
    decoded: (units) => { stats.decoded += units; },
    inlineAsset: () => { stats.assets += 1; },
  });
  return {
    stats,
    parser: createJsonMetadataScanner({ ...common, createTextScanner: inline ? createInline : createTextScanner, rootScope: "snapshot", scanKeys: true, ...options }),
    inline: createInline(),
  };
}

function scan(json, chunkSize = TEXT_WINDOW, options) {
  const { parser, stats } = harness(options);
  for (let index = 0; index < json.length; index += chunkSize) parser.write(json.slice(index, index + chunkSize));
  parser.finish();
  return stats;
}

test("only exact snapshot query rows and their descendants permit generic analytical token fields", () => {
  const allowed = [
    '{"queries":{"q":{"rows":[{"token":"metric","secret":"category","nested":[{"token":"value"}]}]}}}',
    '{"qu\\u0065ries":{"q":{"r\\u006fws":[{"to\\u006ben":"metric"}]}}}',
    '{"queries":{"q":{"rows":[{"token":"metric"}]}},"queries":{}}',
    '{"queries":{"q":{"rows":[{"source":{"token":"category"}}],"rows":[]}}}',
  ];
  for (const json of allowed) assert.doesNotThrow(() => scan(json, 1));
  const rejected = [
    '{"queries":{"q":{"rows":[{"api_key":"value"}]}}}',
    '{"queries":{"q":{"rows":[{"token":"metric"}],"source":{"token":"credential"}}}}',
    '{"queries":{"q":{"rows":{"token":"credential"}}}}',
    '{"queries":{"q":{"r-o-w-s":[{"token":"credential"}]}}}',
    '{"Queries":{"q":{"rows":[{"token":"credential"}]}}}',
    '{"queries":[{"rows":[{"token":"credential"}]}]}',
    '{"queries":{"q":[{"rows":[{"token":"credential"}]}]}}',
    '{"other":{"queries":{"q":{"rows":[{"token":"credential"}]}}}}',
    '{"queries":{"q":{"metadata":{"rows":[{"token":"credential"}]}}}}',
    '{"queries":{"q":{"rows":[],"token":"credential"}}}',
    '{"queries":{"q":{"rows":[]}},"token":"credential"}',
  ];
  for (const json of rejected) assert.throws(() => scan(json, 3), disclosure);
});

test("duplicate ancestor metadata and escaped key/value literals remain inspected", () => {
  const escaped = credential.replace("s", "\\u0073");
  const rejected = [
    '{"source":{"token":"credential"},"source":{}}',
    '{"queries":{"q":{"source":{"api_key":"credential"},"source":{}}}}',
    '{"source":[{"token":"credential"}],"source":null}',
    '{"sour\\u0063e":{"token":"credential"},"source":{}}',
    `{"source":{"${escaped}":0},"source":{}}`,
    `{"source":{"x":"${escaped}"},"source":{}}`,
    `{"queries":{"q":{"rows":[{"${escaped}":0}]}}}`,
  ];
  for (const json of rejected) assert.throws(() => scan(json, 1), disclosure);
});

test("optional snapshot scope and key scanning leave default metadata semantics unchanged", () => {
  const json = '{"queries":{"q":{"rows":[{"token":"category"}]}}}';
  assert.doesNotThrow(() => scan(json));
  assert.throws(() => scan(json, 7, { rootScope: "metadata", scanKeys: false }), disclosure);
  assert.doesNotThrow(() => scan(`{"${credential}":0}`, 7, { rootScope: "metadata", scanKeys: false }));
  assert.throws(() => scan(`{"${credential}":0}`), disclosure);
});

test("invalid JSON does not acquire decoded metadata interpretation", () => {
  const secret = '{"source":{"api_key":"credential"},"source":{}';
  for (const suffix of ["", ',"bad":01}', ',"bad":1e+}', ',"bad":"\\x41"}', "}{}", ",}"]) {
    const json = secret + suffix;
    assert.throws(() => JSON.parse(json), SyntaxError);
    assert.doesNotThrow(() => scan(json, 2));
  }
  assert.throws(() => scan('{"x":'.repeat(MAX_DEPTH + 1) + "0" + "}".repeat(MAX_DEPTH + 1)), /depth limit/u);
});

const dataUrl = (text, base64, mime = "text/javascript") => base64
  ? `data:${mime};base64,${Buffer.from(text).toString("base64")}`
  : `data:${mime},${Array.from(Buffer.from(text), (byte) => `%${byte.toString(16).padStart(2, "0")}`).join("")}`;

test("JSON-escaped inline headers in overwritten values and keys receive one complete decode layer", () => {
  for (const base64 of [true, false]) {
    const uri = dataUrl(credential, base64).replace("data", "\\u0064ata");
    for (const json of [`{"x":"${uri}","x":""}`, `{"${uri}":0}`]) {
      for (const chunk of [1, 2, 3, 7, TEXT_WINDOW]) assert.throws(() => scan(json, chunk), disclosure);
    }
    const metadataUri = dataUrl('{"to\\u006ben":"credential"}', base64, "application/json").replace("data", "\\u0064ata");
    assert.throws(() => scan(`{"x":"${metadataUri}","x":""}`, 1), disclosure);
  }
});

test("streamed inline payloads preserve percent UTF-8, base64 quanta, headers and MIME behavior", () => {
  const data = "safe λ雪😀 " + "x".repeat(TEXT_WINDOW * 2 + 1);
  for (const base64 of [true, false]) {
    for (const mime of ["text/javascript", "text/ecmascript", "text/plain", "text/html", "text/css", "application/javascript", "application/ecmascript", "application/json", "image/svg+xml"]) {
      const uri = dataUrl(data, base64, mime).replace("data:", "DATA:").replace(mime, `${mime};charset=utf-8`);
      const result = scan(JSON.stringify({ x: uri }), 17);
      assert.equal(result.assets, 1);
      assert.equal(result.decoded, data.length);
      assert.ok(result.maxWrite <= TEXT_WINDOW + 1);
    }
  }
});

test("late malformed inline payloads do not activate a partially decoded credential", () => {
  for (const base64 of [true, false]) {
    const uri = dataUrl(credential, base64);
    const invalidSuffixes = base64 ? ["?", "===", "=A", "_"] : ["%", "%A", "%GG", "%C0%AF", "%E2"];
    for (const suffix of invalidSuffixes) {
      // These have no raw literal credential; only a valid decoded URI can reject.
      const { inline, stats } = harness();
      for (const character of uri + suffix) inline.write(character);
      assert.doesNotThrow(() => inline.finish());
      assert.equal(stats.assets, 0);
    }
  }
});

test("inline terminators, malformed headers and empty payloads match existing URL boundaries", () => {
  const safe = dataUrl("safe", true);
  const bad = dataUrl(credential, true);
  for (const separator of [" ", "\n", '"', "'", "<", ">", "`", "#", ")"]) {
    assert.throws(() => {
      const { inline } = harness();
      for (const character of safe + separator + bad) inline.write(character);
      inline.finish();
    }, disclosure);
  }
  for (const prefix of ["xdata:", "data:application/octet-stream;", "data:text/plain;charset=;", "data:text/plain;unknown=foo;"]) {
    const { inline, stats } = harness();
    inline.write(prefix + "base64," + Buffer.from(credential).toString("base64"));
    assert.doesNotThrow(() => inline.finish());
    assert.equal(stats.assets, 0);
  }
  assert.equal(scan('{"x":"data:text/plain;base64,"}').assets, 0);
});

test("arbitrary charset and key lengths remain bounded without dropping a later credential", () => {
  const long = "x".repeat(TEXT_WINDOW * 3);
  const uri = `data:text/plain;charset=${long};base64,${Buffer.from(credential).toString("base64")}`;
  assert.throws(() => scan(JSON.stringify({ x: uri }), 11), disclosure);
  assert.throws(() => scan(JSON.stringify({ [long + " " + credential]: 0 }), 11), disclosure);
  const stats = scan(JSON.stringify({ [long]: long }), 11);
  assert.ok(stats.maxWrite <= TEXT_WINDOW + 1);
});

test("raw snapshot adapter matches established inline scanning for Unicode headers and malformed payloads", () => {
  const base64 = Buffer.from(credential).toString("base64");
  const percent = Array.from(Buffer.from(credential), byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
  const cases = [
    ...["utf-8", "UTF_8", "ſ", "K", "-"].map(charset => `data:text/plain;charset=${charset};base64,${base64}`),
    `data:text/javaſcript;base64,${base64}`,
    `DATA:TEXT/PLAIN;CHARSET=UTF-8;BASE64,${base64}`,
    ...["", "=", "==", "===", "=A", "_", "?", ")"].map(suffix => `data:text/plain;base64,${base64}${suffix}`),
    ...["", "%", "%A", "%GG", "%E2", "%E2x", "%C0%AF", "%00", "%EF%BB%BF", "%F0%9F%98%80"].map(suffix => `data:text/plain,${percent}${suffix}`),
    ...["", " ", "a.b", "/", "a;", "λ"].map(charset => `data:text/plain;charset=${charset};base64,${base64}`),
    `prefixdata:text/plain;base64,${base64}`,
    `data:application/json;base64,${Buffer.from('{"to\\u006ben":"inert"}').toString("base64")}`,
    `data:application/json;base64,${Buffer.from('{"to\\u006ben":"inert",}').toString("base64")}`,
  ];
  const result = input => {
    try { assertNoPublicationSecrets({ html: "", seedSnapshot: {}, initialPresentation: {}, ...input }); return "accepted"; }
    catch (error) {
      assert.match(error.message, /Publication contains a possible credential/u);
      return "rejected";
    }
  };
  for (const uri of cases) {
    const snapshotText = `{"x":${JSON.stringify(uri).replace(/data/giu, "\\u0064ata")},"x":""}`;
    assert.equal(result({ snapshotText, seedSnapshot: JSON.parse(snapshotText) }), result({ html: uri }));
    assert.equal(result({ snapshotBytes: Buffer.from(snapshotText), seedSnapshot: JSON.parse(snapshotText) }), result({ html: uri }));
  }
});

test("byte snapshot scans carry UTF-8 and escaped duplicate metadata across bounded decode windows", () => {
  const prefix = '{"padding":"' + "a".repeat(TEXT_WINDOW - 13) + '🧪",';
  for (const ending of [
    '"api\\u005fkey":"inert-test-value","api_key":""}',
    '"source":{"token":"inert-test-value"},"source":{}}',
    '"overwritten":"\\u0064ata:text/plain,sk-proj-' + "a".repeat(24) + '","overwritten":""}',
  ]) {
    const source = prefix + ending;
    assert.throws(() => assertNoPublicationSecrets({ html: "", snapshotBytes: Buffer.from(source), seedSnapshot: JSON.parse(source) }),
      /Publication contains a possible credential/u);
  }
  const source = prefix + '"queries":{"q":{"rows":[{"token":"metric"}]}}}';
  const result = assertNoPublicationSecrets({ html: "", snapshotBytes: Buffer.from(source), seedSnapshot: JSON.parse(source) });
  assert.equal(result.complete, true);
  assert.ok(result.maximumTextWindowUnits <= 1024 * 1024);
  assert.throws(() => assertNoPublicationSecrets({ html: "", snapshotBytes: Buffer.from([123, 34, 120, 34, 58, 34, 0xc3, 34, 125]) }),
    /valid UTF-8 JSON/u);
});
