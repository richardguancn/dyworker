import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  createStreamingJsonParser,
  parseJsonBytes,
  parseJsonResponse,
  stringifyJsonChunks,
} from "../templates/data-app/base/src/streaming-json.js";

function parseChunks(text, chunkSize = 1) {
  const parser = createStreamingJsonParser();
  for (let index = 0; index < text.length; index += chunkSize) parser.write(text.slice(index, index + chunkSize));
  return parser.finish();
}

function stringify(value) {
  const chunks = [...stringifyJsonChunks(value)];
  assert.ok(chunks.every((chunk) => chunk.length <= 64 * 1024));
  return chunks.length ? chunks.join("") : undefined;
}

const valid = [
  'null', 'true', 'false', '0', '-0', '1e400', '-1e400', '1e-400', '-1e-400', '1.234567890123456789',
  '1.7976931348623157e308', '5e-324', '2.2250738585072014e-308', '9007199254740993',
  ' [ true, false, null, -0, {"a": [1, 2, 3]} ]\r\n\t',
  '{"10":1,"2":2,"a":3,"1":4,"a":5,"__proto__":{"polluted":true},"constructor":7}',
  '"\\\"\\\\\\/\\b\\f\\n\\r\\t\\u0000\\ud800\\udc00\\uD83D\\uDE00\\udfff"',
  '"💗𐐀\ud800\udfff﻿"', '{"":null,"nul\\u0000key":3}', '[]', '{}',
];

const invalid = [
  '', ' ', '\uFEFF{}', 'undefined', 'NaN', 'Infinity', '-Infinity', '+1', '-', '01', '-01', '00', '1.', '.1',
  '1e', '1e-', '1e+', '1ee2', '1e2e3', '1+2', '1-2', '[1,]', '[,1]', '[1 2]', '{"a":1,}',
  '{"a" 1}', '{a:1}', '{"a":}', 'true false', '{}[]', 'nul', 'tru', 'fals', 'True', 'nullx',
  '"', '"a', '"\\', '"\\u123', '"\\u12xz"', '"\\x20"', '"\\v"', '"\\0"', '"a\nb"',
  '"a\u0000b"', '[}', '{]', '{"a": [1}', '[1', '{"a":1', '\v1', '\f1', '1\u00a0',
];

test("streaming parsing matches native JSON at every text split", () => {
  for (const text of valid) {
    const expected = JSON.parse(text);
    for (let index = 0; index <= text.length; index += 1) {
      const parser = createStreamingJsonParser();
      parser.write(text.slice(0, index));
      parser.write("");
      parser.write(text.slice(index));
      assert.deepEqual(parser.finish(), expected, `${text} split ${index}`);
    }
    assert.deepEqual(parseChunks(text), expected);
    assert.equal(stringify(expected), JSON.stringify(expected));
  }
  const value = parseChunks('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(Object.prototype.polluted, undefined);
});

test("malformed and truncated JSON is rejected across chunk boundaries", () => {
  for (const text of invalid) {
    assert.throws(() => JSON.parse(text), SyntaxError);
    for (const size of [1, 2, 7, Math.max(text.length, 1)]) {
      assert.throws(() => parseChunks(text, size), SyntaxError, `${JSON.stringify(text)} chunks ${size}`);
    }
  }
  for (const text of ['{"a":[true,null,"a\\u1234b",{"x":42}]}', '[1,2,3]']) {
    for (let index = 0; index < text.length; index += 1) assert.throws(() => parseChunks(text.slice(0, index)), SyntaxError);
  }
});

test("parser lifecycle rejects reuse and wrong chunk types", () => {
  const parser = createStreamingJsonParser();
  assert.throws(() => parser.write(new Uint8Array()), TypeError);
  parser.write("null");
  assert.equal(parser.finish(), null);
  assert.throws(() => parser.finish(), SyntaxError);
  assert.throws(() => parser.write(" "), SyntaxError);
  const failed = createStreamingJsonParser();
  assert.throws(() => failed.write("!"), SyntaxError);
  assert.throws(() => failed.write("0"), SyntaxError);
  assert.throws(() => failed.finish(), SyntaxError);
});

test("discard validates full grammar while preserving metadata and native duplicate semantics", () => {
  const paths = [];
  const parser = createStreamingJsonParser({
    discard(path) {
      paths.push(path);
      return path.length === 3 && path[0] === "queries" && path[2] === "rows";
    },
  });
  const text = '{"title":"Full","queries":{"q":{"rows":[{"v":1},{"v":2}],"count":2},"p":{"rows":{"x":[1]}}},"tail":true}';
  for (const character of text) parser.write(character);
  assert.deepEqual(parser.finish(), { title: "Full", queries: { q: { rows: [], count: 2 }, p: { rows: {} } }, tail: true });
  assert.ok(paths.some((path) => JSON.stringify(path) === '["queries","q","rows"]'));
  const bad = createStreamingJsonParser({ discard: () => true });
  assert.throws(() => { bad.write('{"rows":[{"secret":"\\uXX00"}]}'); bad.finish(); }, SyntaxError);
  const duplicates = createStreamingJsonParser({ discard: (path) => path.length === 1 && path[0] === "rows" });
  duplicates.write('{"rows":[1],"rows":42}');
  assert.deepEqual(duplicates.finish(), { rows: 42 });
});

test("onValue observes all duplicates and paths before overwrite, even in discarded rows", () => {
  const seen = [];
  const parser = createStreamingJsonParser({
    discard: (path) => path.length === 1 && path[0] === "rows",
    onValue: ({ value, path }) => { if (typeof value !== "object") seen.push({ value, path }); },
  });
  parser.write('{"rows":[{"x":"first","x":"last"}],"__proto__":"own"}');
  assert.deepEqual(parser.finish(), JSON.parse('{"rows":[],"__proto__":"own"}'));
  assert.deepEqual(seen, [
    { value: "first", path: ["rows", 0, "x"] },
    { value: "last", path: ["rows", 0, "x"] },
    { value: "own", path: ["__proto__"] },
  ]);
});

test("byte adapter preserves native Buffer BOM and replacement UTF-8 behavior, with fatal opt-in", () => {
  for (const text of valid.filter((text) => !text.includes("\ud800") && !text.includes("\udfff"))) {
    const bytes = Buffer.from(text);
    assert.deepEqual(parseJsonBytes(bytes), JSON.parse(bytes.toString("utf8")));
    assert.deepEqual(parseJsonBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), JSON.parse(text));
  }
  const badUtf8 = Buffer.from([0x22, 0xe2, 0x82, 0x22]);
  assert.equal(parseJsonBytes(badUtf8), JSON.parse(badUtf8.toString("utf8")));
  assert.throws(() => parseJsonBytes(badUtf8, { fatal: true }), TypeError);
  const bom = Buffer.from('\uFEFF{"a":1}');
  assert.throws(() => parseJsonBytes(bom), SyntaxError);
  assert.deepEqual(parseJsonBytes(bom, { ignoreBOM: false }), { a: 1 });
  const text = `"${"a".repeat(65534)}💗𐐀"`;
  assert.equal(parseJsonBytes(Buffer.from(text)), JSON.parse(text));
});

function streamedResponse(bytes, size = 1, hooks = {}) {
  let offset = 0;
  return {
    body: new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else {
          controller.enqueue(bytes.subarray(offset, offset + size));
          offset = Math.min(bytes.length, offset + size);
        }
      },
      cancel(reason) { hooks.cancelled = reason; },
    }),
    json() { assert.fail("whole-response json was used"); },
    text() { assert.fail("whole-response text was used"); },
  };
}

test("response adapter handles UTF-8 boundaries and BOM like Response.json", async () => {
  for (const bytes of [Buffer.from('\uFEFF{"💗":"𐐀","x":1}'), Buffer.from([0x22, 0xe2, 0x82, 0x22])]) {
    for (const size of [1, 2, 3, 65536]) {
      const response = streamedResponse(bytes, size);
      assert.deepEqual(await parseJsonResponse(response), await new Response(bytes).json());
      assert.equal(response.body.locked, false);
    }
  }
  const bytes = Buffer.from(`{"text":"${"a".repeat(150000)}💗"}`);
  assert.deepEqual(await parseJsonResponse(streamedResponse(bytes, bytes.length)), JSON.parse(bytes.toString()));
  await assert.rejects(parseJsonResponse({ body: null }), SyntaxError);
});

test("response adapter propagates failures, cancels, and releases its reader", async () => {
  const hooks = {};
  const response = streamedResponse(Buffer.from('! trailing unread bytes'), 1, hooks);
  await assert.rejects(parseJsonResponse(response), SyntaxError);
  assert.ok(hooks.cancelled instanceof SyntaxError);
  assert.equal(response.body.locked, false);
  const readFailure = new Error("connection interrupted");
  const broken = { body: new ReadableStream({ pull(controller) { controller.error(readFailure); } }) };
  await assert.rejects(parseJsonResponse(broken), (error) => error === readFailure);
  assert.equal(broken.body.locked, false);
  const badUtf8 = streamedResponse(Buffer.from([0x22, 0xff, 0x22]));
  await assert.rejects(parseJsonResponse(badUtf8, { fatal: true }), TypeError);
  assert.equal(badUtf8.body.locked, false);
  const abort = new AbortController();
  const pending = { body: new ReadableStream({ start(controller) { abort.signal.addEventListener("abort", () => controller.error(abort.signal.reason)); } }) };
  const parsing = parseJsonResponse(pending);
  abort.abort();
  await assert.rejects(parsing, (error) => error.name === "AbortError");
  assert.equal(pending.body.locked, false);
});

test("serializer matches compact native output with bounded escaped-string chunks", () => {
  const escaped = '\u0000"\\\n\ud800'.repeat(30000);
  const surrogateBoundary = `${"a".repeat(8191)}💗${"a".repeat(8190)}💗\ud800x\udfff`;
  const value = { [escaped]: escaped, surrogateBoundary, empty: "", numbers: [-0, Infinity, -Infinity, NaN] };
  assert.equal(stringify(value), JSON.stringify(value));
  const chunks = stringifyJsonChunks(["a".repeat(200000), "tail"]);
  const first = chunks.next();
  assert.equal(first.done, false);
  assert.ok(first.value.length <= 65536);
  chunks.return();
});

test("serializer supports ordinary JSON.stringify omission, holes, toJSON, sharing and cycles", () => {
  const shared = { a: 1 };
  const values = [
    undefined, () => {}, Symbol("x"),
    { omit: undefined, function: () => {}, symbol: Symbol("x"), keep: null },
    [undefined, () => {}, Symbol("x"), , new Number(3), new String("x"), new Boolean(false)],
    { a: shared, b: shared, date: new Date("2026-01-01T00:00:00Z"), custom: { toJSON(key) { return key; } } },
  ];
  for (const value of values) assert.equal(stringify(value), JSON.stringify(value));
  const cycle = { a: 1 };
  cycle.next = cycle;
  assert.throws(() => stringify(cycle), TypeError);
  assert.throws(() => stringify(1n), TypeError);
  assert.throws(() => stringify(Object(1n)), TypeError);
  const callable = () => {};
  callable.toJSON = () => "function JSON";
  assert.equal(stringify(callable), JSON.stringify(callable));
  let toJSONReads = 0;
  const custom = { get toJSON() { toJSONReads += 1; return () => "custom"; } };
  assert.equal(stringify(custom), '"custom"');
  assert.equal(toJSONReads, 1);
  const reads = [];
  const object = { get a() { reads.push("a"); this.c = 3; return 1; }, b: 2 };
  assert.equal(stringify(object), '{"a":1,"b":2}');
  assert.deepEqual(reads, ["a"]);
});

test("very deep JSON uses iterative container stacks", () => {
  const depth = 20000;
  const text = `${"[".repeat(depth)}0${"]".repeat(depth)}`;
  const value = parseChunks(text, 997);
  assert.equal(stringify(value), text);
  let cursor = value;
  for (let index = 0; index < depth; index += 1) cursor = cursor[0];
  assert.equal(cursor, 0);
});

test("retaining small parsed strings does not retain their full decoding windows", () => {
  const moduleUrl = new URL("../templates/data-app/base/src/streaming-json.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--max-old-space-size=48", "--input-type=module", "-"], {
    encoding: "utf8",
    input: `
      import assert from "node:assert/strict";
      import { createStreamingJsonParser } from ${JSON.stringify(moduleUrl)};
      const parser = createStreamingJsonParser();
      const padding = " ".repeat(64 * 1024);
      parser.write("[");
      for (let index = 0; index < 1500; index += 1) {
        parser.write((index ? "," : "") + '"retained-value-' + index + '"' + padding);
      }
      parser.write("]");
      const value = parser.finish();
      assert.equal(value.length, 1500);
      assert.equal(value[1499], "retained-value-1499");
    `,
    timeout: 30000,
  });
  assert.equal(child.status, 0, child.stderr || String(child.error));
});

test("long numeric tokens preserve native rounding, negative zero, and grammar", () => {
  const midpoint = (5n ** 1075n).toString();
  const literals = [
    `0.${"0".repeat(200000)}1`, `1${"0".repeat(200000)}e-200000`,
    `-0e${"9".repeat(200000)}`, `1e-${"0".repeat(200000)}2`,
    `0.${"0".repeat(1075 - midpoint.length)}${midpoint}${"0".repeat(3000)}`,
    `0.${"0".repeat(1075 - midpoint.length)}${midpoint}${"0".repeat(3000)}1`,
    `1.${"0".repeat(1200)}1e0`,
    `1.${"9".repeat(1200)}e308`,
  ];
  for (const literal of literals) {
    for (const size of [97, 65536]) assert.ok(Object.is(parseChunks(literal, size), JSON.parse(literal)), literal.slice(0, 100));
  }
  assert.throws(() => parseChunks(`0${"0".repeat(100000)}`, 8192), SyntaxError);
});

test("deterministic randomized nested values and numbers match native parsing and serialization", () => {
  let state = 0x523d7a91;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const alphabet = ['a', '💗', '\u0000', '"', '\\', '\ud800', '\udfff', '\n', 'é', '﻿'];
  const randomString = () => Array.from({ length: Math.floor(random() * 25) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
  function value(depth) {
    const type = Math.floor(random() * (depth < 5 ? 6 : 4));
    if (type === 0) return null;
    if (type === 1) return random() < 0.5;
    if (type === 2) return (random() - 0.5) * 10 ** Math.floor(random() * 620 - 310);
    if (type === 3) return randomString();
    if (type === 4) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: Math.floor(random() * 5) }, () => [randomString(), value(depth + 1)]));
  }
  for (let index = 0; index < 400; index += 1) {
    const original = value(0);
    const text = JSON.stringify(original);
    assert.deepEqual(parseChunks(text, 1 + Math.floor(random() * 31)), JSON.parse(text));
    assert.equal(stringify(original), text);
    const digits = Array.from({ length: Math.floor(random() * 1600) }, () => Math.floor(random() * 10)).join("");
    const numeric = `${random() < 0.5 ? "-" : ""}${Math.floor(random() * 9) + 1}.${digits || "0"}e${Math.floor(random() * 700 - 350)}`;
    assert.ok(Object.is(parseChunks(numeric, 37), JSON.parse(numeric)), numeric.slice(0, 100));
  }
});
