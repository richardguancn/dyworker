// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-ui-session/README.md。
/*!
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// vendor/dsh-ui-session/packages/client/ui-session/src/client/index.ts
import { Service } from "@deepseek-ai/cordis";

// node_modules/@deepseek-ai/dsh-client-store/lib/index.js
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) try {
    listener(...args);
  } catch (error) {
    console.error(`${label} subscriber failed:`, error);
  }
}

// vendor/dsh-ui-session/packages/util/values/src/partial-json.ts
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class _PartialArguments {
  /** The view of a call with no arguments available. */
  static EMPTY = _PartialArguments.fromObject({});
  /**
   * View finished argument text without scanning it until a reader asks.
   * @param text - the complete argument JSON text.
   * @returns a sealed view.
   */
  static fromText(text) {
    const view = new _PartialArguments();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
   * View an already parsed argument payload, such as a PTC dispatch object.
   * @param value - the parsed argument value.
   * @returns a sealed view; a non-object payload has no fields.
   */
  static fromObject(value) {
    const view = new _PartialArguments();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
   * The source: text so far or a parsed object, plus whether it can still grow.
   * These are the only enumerable fields, so two views over the same source
   * compare equal structurally however far each has been read.
   */
  chunks = [];
  object;
  sealed = false;
  // Scan progress, located fields, and remembered reads are caches over the source.
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
   * Retain streamed argument text without scanning or comparing observed answers.
   * @param fragment - the text following every fragment appended before.
   */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
   * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
   * @param text - the final argument text, which replaces missing or conflicting deltas.
   * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
   */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return _PartialArguments.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return _PartialArguments.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
   * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
   * @returns whether any observed answer changed since its first read or the preceding refresh.
   */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read of this.#reads.values()) {
      if (read.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read) || changed;
    }
    if (completions) {
      for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read) {
    const now = read.answer();
    if (Object.is(now, read.last)) return false;
    read.last = now;
    return true;
  }
  /**
   * Check whether no further fields can arrive.
   * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
   */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
   * List discovered fields in first-appearance order.
   * @returns top-level keys seen so far, in first-appearance order.
   */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
   * Check whether a top-level field has appeared.
   * @param key - argument name.
   * @returns whether the field has appeared (a string opened or another value began).
   */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
   * Check whether a field's closing delimiter has arrived, without validating its contents.
   * @param key - argument name.
   * @returns whether its delimiter arrived and no content reader has reported an error for this value.
   */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
   * Read string length without materializing its text.
   * @param key - argument name.
   * @param options - change granularity for a streaming string.
   * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
   */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(
      `length:${step}:${offset}`,
      key,
      () => this.lengthNow(key),
      (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step)
    );
  }
  /**
   * Check a string against a decoded UTF-16 length limit without materializing it.
   * @param key - argument name.
   * @param maxLength - decoded UTF-16 limit, floored to at least zero.
   * @returns whether the string is longer than the limit; false when absent or not a string.
   */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(
      `exceeds:${limit}`,
      key,
      () => (this.lengthNow(key, limit + 1) ?? 0) > limit
    );
  }
  /**
   * Read a decoded string, including a streaming prefix.
   * @param key - argument name.
   * @returns the string field's decoded text so far; undefined when absent or not a string.
   */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
   * Read at most the first decoded UTF-16 units of a string.
   * @param key - argument name.
   * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
   * @returns the bounded string prefix; undefined when absent or not a string.
   */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(
      `prefix:${limit}`,
      key,
      () => this.textPrefixNow(key, limit)
    );
  }
  /**
   * Read a completed non-string argument.
   * @param key - argument name.
   * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
   */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read, comparison) {
    this.scan();
    const result = read();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) {
        this.#reads.set(id, {
          completion: kind === "complete",
          answer: comparison === void 0 ? read : () => comparison(read()),
          last: comparison === void 0 ? result : comparison(result)
        });
      }
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read = entry.length ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, limit, false);
    return read.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = { at: entry.end, length: text.length, text };
    }
    const read = entry.text ??= { at: entry.start, length: 0, text: "" };
    this.readString(entry, read, Number.POSITIVE_INFINITY, true);
    return read.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read = prefixes.get(maxLength);
    if (read === void 0) {
      read = { at: entry.start, length: 0, text: "" };
      prefixes.set(maxLength, read);
    }
    this.readString(entry, read, maxLength, true);
    return read.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field = this.object[key];
      return typeof field === "string" ? void 0 : field;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) {
      try {
        entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
      } catch (_error) {
        entry.invalid = true;
        this.#invalidValue = true;
      }
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read, limit, materialize) {
    const end = Math.min(
      entry.end < 0 ? this.#consumed : entry.end,
      entry.invalidAt ?? Number.POSITIVE_INFINITY,
      this.#invalidAt ?? Number.POSITIVE_INFINITY
    );
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize) read.text += this.slice(read.at, read.at + length);
      read.at += length;
      read.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read.at);
    while (read.at < end && read.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
      if (length > 0) {
        if (materialize) read.text += remaining.slice(0, length);
        read.at += length;
        read.length += length;
        if (read.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) {
        decoded = SIMPLE_ESCAPES[type];
      }
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read.text += decoded;
      read.length++;
      read.at += width;
      while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote = fragment.indexOf('"', at);
      const end = quote < 0 ? fragment.length : quote;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote < 0 && escaped;
      if (quote < 0 || !escaped) return end;
      at = quote + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) {
      try {
        this.#key = JSON.parse(`"${raw}"`);
      } catch (_error) {
        this.fail();
        return;
      }
    } else {
      this.#key = raw;
    }
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({ kind: "value", start: at, end: -1, parsed: void 0, invalid: false });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};

// vendor/dsh-ui-session/packages/util/values/src/index.ts
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
var WeakMapWithValues = class {
  keys = /* @__PURE__ */ new WeakMap();
  valueSet = /* @__PURE__ */ new Set();
  /** Live strongly retained values in insertion order. */
  values = this.valueSet;
  /**
   * Read the value associated with a key.
   * @param key - weakly held lookup key.
   * @returns the associated value, or absence.
   */
  get(key) {
    return this.keys.get(key);
  }
  /**
   * Test whether a key has an association.
   * @param key - weakly held lookup key.
   * @returns whether the key is present.
   */
  has(key) {
    return this.keys.has(key);
  }
  /**
   * Associate one key with one caller-unique value.
   * @param key - weakly held lookup key.
   * @param value - strongly retained value that belongs to no other key.
   * @returns this container.
   */
  set(key, value) {
    if (this.keys.has(key)) {
      const previous = this.keys.get(key);
      if (previous === value) return this;
      this.valueSet.delete(previous);
    }
    this.keys.set(key, value);
    this.valueSet.add(value);
    return this;
  }
  /**
   * Remove one association and its strongly retained value.
   * @param key - weakly held lookup key.
   * @returns whether an association was removed.
   */
  delete(key) {
    if (!this.keys.has(key)) return false;
    const value = this.keys.get(key);
    const deleted = this.keys.delete(key);
    this.valueSet.delete(value);
    return deleted;
  }
  /** Remove every association and strongly retained value. */
  clear() {
    this.keys = /* @__PURE__ */ new WeakMap();
    this.valueSet.clear();
  }
};

// vendor/dsh-ui-session/packages/client/ui-slots/src/renderer.ts
function standardHookPropName(name) {
  return `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
}
var StaleAuthorizationError = class extends Error {
};

// vendor/dsh-ui-session/packages/client/ui-slots/src/index.ts
var NO_ENTRIES = Object.freeze([]);
var SlotCore = class {
  records = /* @__PURE__ */ new Map();
  factories = /* @__PURE__ */ new Map();
  mutateListeners = /* @__PURE__ */ new Set();
  /** Shared-handle scope ledger: handle → the scope it first mounted under + live mount count. */
  handleScopes = /* @__PURE__ */ new Map();
  // Dirty records, not keys: records are never removed, so holding the
  // reference skips a lookup (and an unreachable missing-record branch) at flush.
  dirty = /* @__PURE__ */ new Set();
  flushScheduled = false;
  /**
   * Entries retired by an abdicating crash report
   * ({@link SlotCore.reportEntryError}): excluded from
   * {@link SlotCore.entriesOfSlot} projections for the rest of their
   * registration's life, while the registration itself stays on the ledger
   * (disposal authority remains with the registrant).
   */
  abdicated = /* @__PURE__ */ new WeakSet();
  entryErrorListeners = /* @__PURE__ */ new Set();
  constructor() {
    const root = this.record("root");
    root.spec = { kind: "single", scope: "root" };
    root.declaredBy = "(built-in)";
    root.declarationEpoch = 1;
  }
  /** Register one reusable Factory definition. */
  registerFactory = ((rawOptions, component) => {
    const options = rawOptions;
    const record = this.factoryRecord(options.name);
    if (record.definition !== void 0) {
      throw new Error(`slot factory "${options.name}" already has a definition`);
    }
    for (const childKey of Object.keys(options.children ?? {})) {
      const childRecord = this.records.get(childKey);
      if (childRecord?.spec !== void 0) {
        throw new Error(`slot "${childKey}" is already declared (by ${childRecord.declaredBy ?? "an unknown entry"})`);
      }
    }
    if (options.store !== void 0 && typeof options.store !== "function") {
      const pinned = this.handleScopes.get(options.store);
      if (pinned !== void 0 && pinned.scope !== options.scope) {
        throw new Error(
          `store handle mounted under factory "${options.name}" (scope "${options.scope}") is already mounted under scope "${pinned.scope}" \u2014 one handle, one scope`
        );
      }
      if (pinned !== void 0) pinned.count += 1;
      else this.handleScopes.set(options.store, { scope: options.scope, count: 1 });
    }
    const definition = {
      name: options.name,
      component,
      scope: options.scope,
      ...options.children === void 0 ? {} : { children: options.children },
      ...options.store === void 0 ? {} : { store: options.store },
      ...options.inject === void 0 ? {} : { inject: options.inject },
      ...options.locale === void 0 ? {} : { locale: options.locale },
      ...options.slots === void 0 ? {} : { slots: options.slots },
      ...options.registrant === void 0 ? {} : { registrant: options.registrant }
    };
    record.definition = definition;
    this.markFactoryDirty(record);
    const declarations = [];
    for (const [childKey, childSpec] of Object.entries(options.children ?? {})) {
      const childRecord = this.record(childKey);
      childRecord.spec = childSpec;
      childRecord.declaredBy = `factory "${options.name}"${options.registrant ? ` (${options.registrant})` : ""}`;
      childRecord.parent = `factory:${options.name}`;
      childRecord.declarationEpoch += 1;
      declarations.push([childKey, childRecord]);
    }
    for (const [childKey, childRecord] of declarations) this.markDirty(childKey, childRecord);
    for (const [, childRecord] of declarations) this.notifyDeclaration(childRecord);
    return () => {
      if (record.definition !== definition) return;
      record.definition = void 0;
      this.markFactoryDirty(record);
      if (definition.store !== void 0 && typeof definition.store !== "function") {
        const pinned = this.handleScopes.get(definition.store);
        if (pinned !== void 0 && --pinned.count === 0) this.handleScopes.delete(definition.store);
      }
      this.releaseChildren(definition.children);
    };
  });
  /**
   * Read one registered Factory definition.
   * @param name - Factory name.
   * @returns the live definition, or `undefined` when absent.
   */
  factory(name) {
    return this.factories.get(name)?.definition;
  }
  /**
   * Read the monotonic definition version for one Factory name.
   * @param name - Factory name.
   * @returns the current version.
   */
  factoryVersion(name) {
    return this.factories.get(name)?.version ?? 0;
  }
  /**
   * Subscribe to one Factory definition's registration lifetime.
   * @param name - Factory name.
   * @param listener - callback notified after a definition change.
   * @returns the unsubscribe function.
   */
  subscribeFactory(name, listener) {
    const record = this.factoryRecord(name);
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }
  /**
   * Return whether a retained Factory definition is still registered.
   * @param definition - retained definition identity.
   * @returns whether that exact definition remains live.
   */
  isFactoryLive(definition) {
    return this.factories.get(definition.name)?.definition === definition;
  }
  /* jscpd:ignore-end */
  register(options, component) {
    const rec = this.records.get(options.name);
    if (!rec?.spec) {
      throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`);
    }
    const spec = rec.spec;
    const priority = options.priority ?? 0;
    const occupantHint = (occupant) => `at priority ${priority}${occupant.registrant !== void 0 ? ` (registered by ${occupant.registrant})` : ""} \u2014 register at a different priority to shadow it (lowest renders)`;
    switch (spec.kind) {
      case "single": {
        const occupant = rec.entries.find((e) => (e.options.priority ?? 0) === priority);
        if (occupant) throw new Error(`single slot "${options.name}" already has a registration ${occupantHint(occupant)}`);
        break;
      }
      case "keyed": {
        if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);
        const occupant = rec.entries.find((e) => e.options.key === options.key && (e.options.priority ?? 0) === priority);
        if (occupant) {
          throw new Error(`keyed slot "${options.name}" already has an entry for key "${options.key}" ${occupantHint(occupant)}`);
        }
        break;
      }
      case "list": {
        if (options.id === void 0) throw new Error(`list slot "${options.name}" requires options.id`);
        const occupant = rec.entries.find((e) => e.options.id === options.id && (e.options.priority ?? 0) === priority);
        if (occupant) {
          throw new Error(`list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`);
        }
        break;
      }
      case "chain":
        if (options.select === void 0) throw new Error(`chain slot "${options.name}" requires options.select`);
        break;
    }
    if (options.children) {
      for (const childKey of Object.keys(options.children)) {
        const childRec = this.records.get(childKey);
        if (childRec?.spec) {
          throw new Error(`slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`);
        }
      }
    }
    if (options.store !== void 0 && typeof options.store !== "function") {
      const pinned = this.handleScopes.get(options.store);
      if (pinned && pinned.scope !== spec.scope) {
        throw new Error(
          `store handle mounted under "${options.name}" (scope "${spec.scope}") is already mounted under scope "${pinned.scope}" \u2014 one handle, one scope`
        );
      }
      if (pinned) pinned.count += 1;
      else this.handleScopes.set(options.store, { scope: spec.scope, count: 1 });
    }
    const entry = {
      component,
      options: {
        ...options.key !== void 0 ? { key: options.key } : {},
        ...options.id !== void 0 ? { id: options.id } : {},
        ...options.order !== void 0 ? { order: options.order } : {},
        ...options.label !== void 0 ? { label: options.label } : {},
        ...options.priority !== void 0 ? { priority: options.priority } : {}
      },
      ...options.select !== void 0 ? { select: options.select } : {},
      ...options.inject !== void 0 ? { inject: options.inject } : {},
      ...options.children !== void 0 ? { children: options.children } : {},
      ...options.store !== void 0 ? { store: options.store } : {},
      ...options.locale !== void 0 ? { locale: options.locale } : {},
      ...options.registrant !== void 0 ? { registrant: options.registrant } : {}
    };
    const next = [...rec.entries, entry];
    next.sort(spec.kind === "list" ? (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0) : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0));
    rec.entries = next;
    this.markDirty(options.name, rec);
    if (options.children) {
      const declarations = [];
      for (const [childKey, childSpec] of Object.entries(options.children)) {
        const childRec = this.record(childKey);
        childRec.spec = childSpec;
        childRec.declaredBy = `an entry in "${options.name}"${options.registrant ? ` (${options.registrant})` : ""}`;
        childRec.parent = options.name;
        childRec.declarationEpoch += 1;
        declarations.push([childKey, childRec]);
      }
      for (const [childKey, childRec] of declarations) {
        this.markDirty(childKey, childRec);
      }
      for (const [, childRec] of declarations) {
        this.notifyDeclaration(childRec);
      }
    }
    return () => {
      if (!rec.entries.includes(entry)) return;
      rec.entries = rec.entries.filter((e) => e !== entry);
      this.markDirty(options.name, rec);
      this.releaseEntry(entry);
    };
  }
  /**
   * Whether a previously obtained entry is still registered (the render
   * machinery's stale-authorization probe: a retained renderSlot binding
   * whose entry left the ledger must not render).
   * @param entry - a previously read entry.
   * @returns false once the entry's registration was disposed.
   */
  isLive(entry) {
    for (const rec of this.records.values()) {
      if (rec.entries.includes(entry)) return true;
    }
    return false;
  }
  /**
   * Snapshot the registered entries for a key. Returns the cached array
   * reference (stable between mutations — safe as a uSES getSnapshot source);
   * empty for keys not (or no longer) declared, so renderers may probe ahead
   * of plugin load order.
   * @param key - slot key (dynamic: the render machinery holds keys as strings).
   * @returns entries in registration (list: order) sequence.
   */
  entries(key) {
    return this.records.get(key)?.entries ?? NO_ENTRIES;
  }
  /**
   * Project a key's entries to its shadowing winners: the first live
   * (non-abdicated) entry of each cell in priority order — single: the slot
   * is one cell; keyed: one cell per `key`; list: one cell per `id` (winners
   * keep ledger sequence; list renderers still refine display by `order`).
   * Chain keys return the raw entries unchanged: election consumes every
   * entry, shadowing does not apply. The raw {@link SlotCore.entries} view
   * stays the inspection surface. Builds a fresh array per call — a render
   * body read, not a uSES getSnapshot source.
   * @param key - slot key (dynamic: the render machinery holds keys as strings).
   * @returns the winning entry per occupied cell (empty while undeclared).
   */
  entriesOfSlot(key) {
    const rec = this.records.get(key);
    if (!rec?.spec) return NO_ENTRIES;
    const kind = rec.spec.kind;
    if (kind === "chain") return rec.entries;
    const heads = [];
    const seenCells = /* @__PURE__ */ new Set();
    for (const entry of rec.entries) {
      if (this.abdicated.has(entry)) continue;
      const cell = kind === "keyed" ? entry.options.key : kind === "list" ? entry.options.id : void 0;
      if (seenCells.has(cell)) continue;
      seenCells.add(cell);
      heads.push(entry);
    }
    return heads;
  }
  /**
   * Look up a slot's declared spec, narrowed by the SlotMap key.
   * @param key - SlotMap key.
   * @returns the spec, or undefined while undeclared.
   */
  spec(key) {
    return this.records.get(key)?.spec;
  }
  /**
   * Dynamic-key escape hatch for spec lookup — renderers resolving keys they
   * only hold as strings (generic dispatch) use this wide form; statically
   * keyed callers use {@link SlotCore.spec}.
   * @param key - candidate slot key.
   * @returns the wide-typed spec, or undefined while undeclared.
   */
  specDynamic(key) {
    return this.records.get(key)?.spec;
  }
  /**
   * Export the current declaration topology without components or executable hooks.
   * Factory definitions appear as `factory:<name>` parents of their ordinary
   * child Slots, matching the parent/child topology of ordinary registrations.
   * @param root - exact Slot or `factory:<name>` key to select; omitted returns every live root.
   * @returns selected live Slot trees, or an empty array when `root` is unavailable.
   */
  snapshot(root) {
    const buildSlot = (name, seen) => {
      const record = this.records.get(name);
      if (record?.spec === void 0 || seen.has(name)) return void 0;
      const branch = new Set(seen);
      branch.add(name);
      const active = new Set(this.entriesOfSlot(name));
      const children = [...this.records.entries()].filter(([, candidate]) => candidate.spec !== void 0 && candidate.parent === name).flatMap(([child]) => {
        const node = buildSlot(child, branch);
        return node === void 0 ? [] : [node];
      });
      return {
        type: "slot",
        name,
        kind: record.spec.kind,
        scope: record.spec.scope,
        ...record.declaredBy === void 0 ? {} : { declaredBy: record.declaredBy },
        occupants: record.entries.map((entry) => ({
          ...entry.registrant === void 0 ? {} : { registrant: entry.registrant },
          ...entry.options.key === void 0 ? {} : { key: entry.options.key },
          ...entry.options.id === void 0 ? {} : { id: entry.options.id },
          ...entry.options.order === void 0 ? {} : { order: entry.options.order },
          priority: entry.options.priority ?? 0,
          active: active.has(entry)
        })),
        children
      };
    };
    const buildFactory = (name) => {
      const definition = this.factories.get(name)?.definition;
      if (definition === void 0) return void 0;
      const nodeName = `factory:${name}`;
      const children = [...this.records.entries()].filter(([, candidate]) => candidate.spec !== void 0 && candidate.parent === nodeName).flatMap(([child]) => {
        const node = buildSlot(child, /* @__PURE__ */ new Set([nodeName]));
        return node === void 0 ? [] : [node];
      });
      return {
        type: "factory",
        name,
        scope: definition.scope,
        ...definition.registrant === void 0 ? {} : { registrant: definition.registrant },
        children
      };
    };
    if (root !== void 0) {
      const node = root.startsWith("factory:") ? buildFactory(root.slice("factory:".length)) : buildSlot(root, /* @__PURE__ */ new Set());
      return node === void 0 ? [] : [node];
    }
    const slots = [...this.records.entries()].filter(([, record]) => record.spec !== void 0 && record.parent === void 0).flatMap(([name]) => {
      const node = buildSlot(name, /* @__PURE__ */ new Set());
      return node === void 0 ? [] : [node];
    });
    const factories = [...this.factories.keys()].flatMap((name) => {
      const node = buildFactory(name);
      return node === void 0 ? [] : [node];
    });
    return [...slots, ...factories];
  }
  /**
   * Read the declaration lifetime of a key. Entry additions and removals do
   * not change it; declaration creation and collapse each advance it.
   * @param key - slot key.
   * @returns monotonic epoch (0 before the first declaration).
   */
  declarationEpoch(key) {
    return this.records.get(key)?.declarationEpoch ?? 0;
  }
  /**
   * Subscribe to registration changes for a key (microtask-batched).
   * Subscribing ahead of declaration is allowed; the declaration notifies.
   * @param key - slot key.
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(key, fn) {
    const rec = this.record(key);
    rec.listeners.add(fn);
    return () => {
      rec.listeners.delete(fn);
    };
  }
  /**
   * Subscribe to declaration lifetime boundaries for a key. Notifications
   * are synchronous so declaration teardown finishes before a subsequent
   * same-tick registration can observe stale resources. Ordinary entry
   * mutations do not notify this surface. A children table commits every
   * sibling declaration before its first notification.
   * @param key - slot key.
   * @param fn - declaration or collapse callback.
   * @returns unsubscribe.
   */
  subscribeDeclaration(key, fn) {
    const rec = this.record(key);
    rec.declarationListeners.add(fn);
    return () => {
      rec.declarationListeners.delete(fn);
    };
  }
  /**
   * Monotonic version for a key, bumped synchronously per mutation so a
   * uSES getSnapshot read is never stale when its batched notification lands.
   * @param key - slot key.
   * @returns current version (0 for untouched keys).
   */
  getVersion(key) {
    return this.records.get(key)?.version ?? 0;
  }
  /**
   * Hook every mutation (the runtime Service wrapper bridges this to ctx.emit).
   * Fires synchronously per mutation, unbatched — event semantics need one
   * emission per change.
   * @param fn - called with the mutated key.
   * @returns unsubscribe.
   */
  onMutate(fn) {
    this.mutateListeners.add(fn);
    return () => {
      this.mutateListeners.delete(fn);
    };
  }
  /**
   * Renderer crash report from an entry boundary. Always notifies
   * {@link SlotCore.onEntryError} listeners; with `info.abdicate` set (the
   * shadowing kinds — single/keyed/list) it first retires the entry from its
   * cell, one-shot: the record's version bumps through the ordinary mutation
   * channel so outlets re-project onto the cell's next survivor, and a
   * repeat abdicating report no-ops entirely. Chain crashes report with
   * `abdicate: false` — election alternatives resolve at select time, so the
   * entry keeps its cell and only the notification fires. The registration
   * itself stays on the ledger either way — raw {@link SlotCore.entries}
   * still lists the entry and its disposer keeps working.
   * @param key - slot key the entry rendered under.
   * @param entry - the crashed entry.
   * @param error - the crash cause, forwarded to listeners verbatim.
   * @param info - `abdicate`: whether the crash retires the entry from its cell.
   */
  reportEntryError(key, entry, error, info) {
    if (info.abdicate) {
      if (this.abdicated.has(entry)) return;
      this.abdicated.add(entry);
      const rec = this.records.get(key);
      if (rec !== void 0) this.markDirty(key, rec);
    }
    for (const fn of [...this.entryErrorListeners]) fn(key, entry, error, { abdicated: info.abdicate });
  }
  /**
   * Report a contained Factory occurrence crash through the ordinary entry
   * supervision channel without retiring the shared definition.
   * @param name - Factory name whose occurrence crashed.
   * @param registration - Factory definition or caller registration that owns the crashing Component.
   * @param error - the crash cause, forwarded to listeners verbatim.
   */
  reportFactoryError(name, registration, error) {
    for (const fn of [...this.entryErrorListeners]) fn(`factory:${name}`, registration, error, { abdicated: false });
  }
  /**
   * Observe ordinary entry and Factory occurrence crashes. Fires synchronously
   * per report, after any ordinary-entry abdication mutation. Factory failures
   * never retire their shared definition.
   * @param fn - called with the Slot or `factory:<name>` key, the crashed
   * registration, the cause, and whether an ordinary entry was retired.
   * @returns unsubscribe.
   */
  onEntryError(fn) {
    this.entryErrorListeners.add(fn);
    return () => {
      this.entryErrorListeners.delete(fn);
    };
  }
  /**
   * Cascade for a removed entry: release its store mount and collapse every
   * child slot it declared — specs clear, contributions empty (their stale
   * disposers no-op), recursively down the declaration tree. One lifecycle
   * axis: ledger rows, slots, contributions, and store mounts die together.
   */
  releaseEntry(entry) {
    if (entry.store !== void 0 && typeof entry.store !== "function") {
      const pinned = this.handleScopes.get(entry.store);
      if (pinned && --pinned.count === 0) this.handleScopes.delete(entry.store);
    }
    this.releaseChildren(entry.children);
  }
  releaseChildren(children) {
    if (children === void 0) return;
    for (const childKey of Object.keys(children)) {
      const childRec = this.records.get(childKey);
      if (!childRec) continue;
      const doomed = childRec.entries;
      childRec.spec = void 0;
      childRec.declaredBy = void 0;
      childRec.parent = void 0;
      childRec.declarationEpoch += 1;
      childRec.entries = NO_ENTRIES;
      this.markDirty(childKey, childRec);
      this.notifyDeclaration(childRec);
      for (const dead of doomed) this.releaseEntry(dead);
    }
  }
  record(key) {
    let rec = this.records.get(key);
    if (!rec) {
      rec = {
        spec: void 0,
        declaredBy: void 0,
        parent: void 0,
        declarationEpoch: 0,
        entries: NO_ENTRIES,
        version: 0,
        listeners: /* @__PURE__ */ new Set(),
        declarationListeners: /* @__PURE__ */ new Set()
      };
      this.records.set(key, rec);
    }
    return rec;
  }
  factoryRecord(name) {
    let record = this.factories.get(name);
    if (record === void 0) {
      record = { definition: void 0, version: 0, listeners: /* @__PURE__ */ new Set() };
      this.factories.set(name, record);
    }
    return record;
  }
  markFactoryDirty(record) {
    record.version += 1;
    queueMicrotask(() => {
      for (const listener of [...record.listeners]) listener();
    });
  }
  markDirty(key, rec) {
    rec.version += 1;
    for (const fn of [...this.mutateListeners]) fn(key);
    this.dirty.add(rec);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flush();
      });
    }
  }
  notifyDeclaration(rec) {
    for (const fn of [...rec.declarationListeners]) fn();
  }
  flush() {
    this.flushScheduled = false;
    const dirty = [...this.dirty];
    this.dirty.clear();
    for (const rec of dirty) {
      for (const fn of [...rec.listeners]) fn();
    }
  }
};

// vendor/dsh-ui-session/packages/client/ui-session/src/client/session-provider.tsx
import { Fragment, jsx } from "react/jsx-runtime";
function renderSessionArea(binding, { empty, children }) {
  if (binding.key === void 0) return /* @__PURE__ */ jsx(Fragment, { children: empty?.() ?? null });
  return /* @__PURE__ */ jsx(Fragment, { children });
}

// vendor/dsh-ui-session/packages/client/ui-session/src/client/index.ts
var PendingInteractionDomain = class {
  constructor(precedence, changed) {
    this.precedence = precedence;
    this.changed = changed;
  }
  values = /* @__PURE__ */ new Map();
  valuesSnapshot() {
    return [...this.values.values()].map((entry) => entry.interaction);
  }
  publish(interaction, delegate) {
    if (this.values.has(interaction.key)) {
      throw new Error(`ui-session: duplicate pending interaction key '${interaction.key}'`);
    }
    this.values.set(interaction.key, { interaction, delegate });
    this.changed();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (!this.values.delete(interaction.key)) return;
      this.changed();
    };
  }
  /** Remove every pending value and return the operations that settle their owners. */
  release() {
    const delegates = [...this.values.values()].map((entry) => entry.delegate);
    this.values.clear();
    return delegates;
  }
};
var BUILTIN_SOURCE = {
  hooks: ["session"],
  keyedHooks: ["projection"],
  props: ["sessionId"],
  resolve: (binding) => ({
    hooks: { session: binding.session },
    keyedHooks: { projection: (key) => binding.session.projections.faceOf(key) },
    props: { sessionId: binding.sessionId }
  })
};
var UiSession = class extends Service {
  /**
   * @param ctx - Client root context.
   * @param sessions - Controller-owned Session object layer.
   */
  constructor(ctx, sessions) {
    super(ctx, "uiSession");
    this.sessions = sessions;
    this.absent = createBindingSource(this.materializeAbsent());
    this.current = createBindingSource(this.absent.value);
    this.adapter = {
      current: this.current,
      bindingSource: (target) => this.bindingSource(target),
      renderArea: renderSessionArea
    };
    ctx.effect(() => {
      const disposeList = sessions.list.subscribe(() => {
        this.publishMain();
      });
      const disposeStatus = sessions.list.subscribe(() => {
        this.reconcileStatus();
      });
      const disposeRemoteStatus = ctx.remote.$on("api-session/status", (sessionId, running) => {
        this.observeRunning(sessionId, running);
      });
      this.publishMain();
      this.reconcileStatus();
      return () => {
        this.active = false;
        disposeList();
        disposeStatus();
        disposeRemoteStatus();
        this.disposeMainRetain();
        const records = [...this.bindings.values];
        this.bindings.clear();
        for (const record of records) record.release();
      };
    }, "ui-session: Session binding projection");
  }
  descriptors = [
    BUILTIN_SOURCE
  ];
  bindings = new WeakMapWithValues();
  absent;
  current;
  pendingDomains = [];
  pendingSnapshot = /* @__PURE__ */ new Map();
  running = /* @__PURE__ */ new Map();
  completionUnread = /* @__PURE__ */ new Set();
  statusSnapshot = /* @__PURE__ */ new Map();
  statusListeners = /* @__PURE__ */ new Set();
  mainRetainId;
  disposeMainRetain = () => {
  };
  active = true;
  /** Root source combining running, pending-interaction, and completion-reminder facts. */
  sessionStatus = {
    getSnapshot: () => this.statusSnapshot,
    subscribe: (listener) => {
      this.statusListeners.add(listener);
      return () => {
        this.statusListeners.delete(listener);
      };
    }
  };
  /** Renderer-facing adapter for `session` and `session-maybe` scopes. */
  adapter;
  /**
   * Resolve a stable renderer source for an owned Session reference or explicit absence.
   * @param reference - active reference supplied by the Provider owner, or absence.
   * @returns the binding source, which falls back to the absent projection when its generation ends.
   * @throws when the reference does not belong to the active Controller generation.
   */
  bindingSource(reference) {
    if (!this.active) return this.absent;
    if (reference === void 0) return this.absent;
    const owner = reference.binding;
    if (this.sessions.binding(reference.sessionId) !== owner) {
      throw new Error("ui-session: Session reference is not active in this Controller");
    }
    return this.sourceFor(owner);
  }
  /**
   * Register one Session-scoped standard-source contribution.
   * @param descriptor - static member roster and per-binding resolver.
   * @returns disposer owned by the caller's Cordis fiber.
   */
  provide(descriptor) {
    const runtimeDescriptor = descriptor;
    const dispose = this.ctx.effect(() => {
      this.descriptors.push(runtimeDescriptor);
      try {
        this.rebuildBindings();
      } catch (error) {
        this.descriptors.pop();
        throw error;
      }
      return () => {
        const index = this.descriptors.indexOf(runtimeDescriptor);
        this.descriptors.splice(index, 1);
        this.rebuildBindings();
      };
    }, "uiSession.provide()");
    return () => {
      void dispose();
    };
  }
  /**
   * Register one pending-interaction domain and return its publication function.
   * Domain teardown first removes its visible values, then delegates and awaits
   * every still-active owner request.
   * @param precedence - deterministic cross-domain precedence; larger values win.
   * @returns a function that publishes one interaction and its teardown delegation.
   */
  registerPendingInteraction(precedence) {
    const domain = new PendingInteractionDomain(precedence, () => {
      this.publishPendingInteractions();
    });
    const runtimeDomain = domain;
    this.ctx.effect(() => {
      this.pendingDomains.push(runtimeDomain);
      this.publishPendingInteractions();
      return async () => {
        const delegates = domain.release();
        const index = this.pendingDomains.indexOf(runtimeDomain);
        this.pendingDomains.splice(index, 1);
        this.publishPendingInteractions();
        await Promise.allSettled(delegates.map((delegate) => Promise.resolve().then(delegate)));
      };
    }, "uiSession.registerPendingInteraction()");
    return (interaction, delegate) => domain.publish(interaction, delegate);
  }
  rebuildBindings() {
    const absent = this.materializeAbsent();
    const updates = [...this.bindings.values].map((record) => ({
      source: record.source,
      value: this.materialize(record.owner)
    }));
    this.absent.value = absent;
    for (const { source, value } of updates) source.value = value;
    notifySubscribers(this.absent.listeners, "[ui-session] absent binding");
    for (const { source } of updates) {
      notifySubscribers(source.listeners, "[ui-session] Session binding");
    }
    this.publishMain();
  }
  sourceFor(owner) {
    const cached = this.bindings.get(owner);
    if (cached !== void 0) return cached.source;
    const record = this.createMaterializedBinding(owner);
    this.bindings.set(owner, record);
    return record.source;
  }
  publishMain() {
    if (!this.active) return;
    const byId = this.sessions.list.getSnapshot().byId;
    const currentId = this.current.value.key;
    const currentIsMain = currentId !== void 0 && (this.sessions.retainInfo(currentId).getSnapshot().retainedBy.mainView ?? 0) > 0;
    const nextId = currentIsMain ? currentId : Object.values(byId).find((candidate) => (candidate.retainedBy.mainView ?? 0) > 0)?.id;
    this.watchMainRetention(nextId);
    const owner = nextId === void 0 ? void 0 : this.sessions.binding(nextId);
    const value = owner === void 0 ? this.absent.value : this.sourceFor(owner).value;
    if (this.current.value === value) return;
    this.current.value = value;
    notifySubscribers(this.current.listeners, "[ui-session] main binding");
  }
  watchMainRetention(sessionId) {
    if (sessionId === this.mainRetainId) return;
    this.disposeMainRetain();
    this.mainRetainId = sessionId;
    this.disposeMainRetain = sessionId === void 0 ? () => {
    } : this.sessions.retainInfo(sessionId).subscribe(() => {
      this.publishMain();
    });
  }
  publishPendingInteractions() {
    const next = /* @__PURE__ */ new Map();
    for (const domain of this.pendingDomains) {
      for (const interaction of domain.valuesSnapshot()) {
        const precedence = domain.precedence(interaction);
        const previous = next.get(interaction.sessionId);
        if (previous === void 0 || precedence >= previous.precedence) {
          next.set(interaction.sessionId, { interaction, precedence });
        }
      }
    }
    const projected = new Map(
      [...next].map(([sessionId, value]) => [sessionId, value.interaction])
    );
    if (samePendingInteractions(this.pendingSnapshot, projected)) return;
    this.pendingSnapshot = projected;
    this.publishStatus();
  }
  observeRunning(sessionId, running) {
    const previous = this.running.get(sessionId);
    const beforeBaseline = this.sessions.list.getSnapshot().phase === "pending";
    this.running.set(sessionId, running);
    if (running) this.completionUnread.delete(sessionId);
    else if ((previous === true || previous === void 0 && beforeBaseline) && !this.isMain(sessionId)) this.completionUnread.add(sessionId);
    this.publishStatus();
  }
  reconcileStatus() {
    const list = this.sessions.list.getSnapshot();
    const present = new Set(Object.keys(list.byId));
    for (const id of list.ids) {
      const row = list.byId[id];
      const previous = this.running.get(id);
      if (previous === void 0) this.running.set(id, row.running);
      else if (previous !== row.running) this.observeRunning(id, row.running);
    }
    for (const id of present) {
      if (this.isMain(id)) this.completionUnread.delete(id);
    }
    if (list.phase === "ready") {
      for (const id of this.running.keys()) {
        if (present.has(id)) continue;
        this.running.delete(id);
        this.completionUnread.delete(id);
      }
    }
    this.publishStatus();
  }
  isMain(sessionId) {
    return (this.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView ?? 0) > 0;
  }
  publishStatus() {
    const ids = /* @__PURE__ */ new Set([
      ...Object.keys(this.sessions.list.getSnapshot().byId),
      ...this.running.keys(),
      ...this.pendingSnapshot.keys(),
      ...this.completionUnread
    ]);
    const next = /* @__PURE__ */ new Map();
    for (const id of ids) {
      next.set(id, {
        running: this.running.get(id),
        pendingInteraction: this.pendingSnapshot.get(id),
        completionUnread: this.completionUnread.has(id)
      });
    }
    if (sameSessionStatus(this.statusSnapshot, next)) return;
    this.statusSnapshot = next;
    notifySubscribers(this.statusListeners, "[ui-session] Session status");
  }
  createMaterializedBinding(owner) {
    const value = this.materialize(owner);
    this.ctx.slots.bindStoreScope(value);
    const source = createBindingSource(value);
    const releaseEffect = owner.ctx.effect(() => () => {
      if (this.bindings.get(owner) === record) this.bindings.delete(owner);
      source.value = this.absent.value;
      notifySubscribers(source.listeners, "[ui-session] Session binding");
      this.publishMain();
    }, `ui-session: binding ${owner.sessionId}`);
    const record = {
      owner,
      source,
      release: () => {
        void releaseEffect();
      }
    };
    return record;
  }
  materialize(binding) {
    const hooks = {};
    const keyedHooks = {};
    const props = {};
    const finalProps = /* @__PURE__ */ new Set();
    for (const descriptor of this.descriptors) {
      const contribution = descriptor.resolve(binding);
      validateContribution(descriptor, contribution);
      copyDeclared("hook", hooks, descriptor.hooks, contribution.hooks, finalProps);
      copyDeclared("keyed hook", keyedHooks, descriptor.keyedHooks, contribution.keyedHooks, finalProps);
      copyDeclared("prop", props, descriptor.props, contribution.props, finalProps);
    }
    const value = {
      key: binding.sessionId,
      ctx: binding.ctx,
      hooks,
      keyedHooks,
      props
    };
    return value;
  }
  materializeAbsent() {
    const hooks = {};
    const keyedHooks = {};
    const props = {};
    const finalProps = /* @__PURE__ */ new Set();
    for (const descriptor of this.descriptors) {
      declareAbsent("hook", hooks, descriptor.hooks, finalProps);
      declareAbsent("keyed hook", keyedHooks, descriptor.keyedHooks, finalProps);
      declareAbsent("prop", props, descriptor.props, finalProps);
    }
    return { key: void 0, hooks, keyedHooks, props };
  }
};
function createBindingSource(value) {
  const source = {
    value,
    listeners: /* @__PURE__ */ new Set(),
    getSnapshot: () => source.value,
    subscribe: (listener) => {
      source.listeners.add(listener);
      return () => {
        source.listeners.delete(listener);
      };
    }
  };
  return source;
}
function validateContribution(descriptor, contribution) {
  rejectUndeclared("hook", descriptor.hooks, contribution.hooks);
  rejectUndeclared("keyed hook", descriptor.keyedHooks, contribution.keyedHooks);
  rejectUndeclared("prop", descriptor.props, contribution.props);
}
function rejectUndeclared(kind, declared, values) {
  for (const name of Object.keys(values ?? {})) {
    if (!(declared ?? []).includes(name)) {
      throw new Error(`uiSession.provide: undeclared ${kind} '${name}'`);
    }
  }
}
function copyDeclared(kind, target, declared, values, finalProps) {
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps);
    const value = values?.[name];
    if (value === void 0) throw new Error(`uiSession.provide: missing ${kind} '${name}'`);
    target[name] = value;
  }
}
function declareAbsent(kind, target, declared, finalProps) {
  for (const name of declared ?? []) {
    claimStandardProp(kind, name, finalProps);
    target[name] = void 0;
  }
}
function claimStandardProp(kind, name, finalProps) {
  const propName = kind === "prop" ? name : standardHookPropName(name);
  if (finalProps.has(propName)) {
    throw new Error(`uiSession.provide: duplicate ${kind} '${name}' at prop '${propName}'`);
  }
  finalProps.add(propName);
}
function sameSessionStatus(left, right) {
  if (left.size !== right.size) return false;
  for (const [id, status] of left) {
    const candidate = right.get(id);
    if (candidate === void 0 || candidate.running !== status.running || candidate.pendingInteraction !== status.pendingInteraction || candidate.completionUnread !== status.completionUnread) return false;
  }
  return true;
}
function samePendingInteractions(left, right) {
  if (left.size !== right.size) return false;
  for (const [sessionId, interaction] of left) {
    if (right.get(sessionId) !== interaction) return false;
  }
  return true;
}

// vendor/dsh-ui-session/packages/client/ui-renderer/src/client/registry.ts
import { Service as Service2 } from "@deepseek-ai/cordis";

// vendor/dsh-ui-session/packages/client/ui-renderer/src/client/errors.ts
var SlotAssemblyError = class extends Error {
};

// vendor/dsh-ui-session/packages/client/ui-renderer/src/client/registry.ts
var ROOT_INSTANCE_KEY = "root";
var SlotRegistry = class extends Service2 {
  _core = new SlotCore();
  /** Store-instance axis: handle -> mounted scope, refcount, resolved instances. */
  _stores = /* @__PURE__ */ new Map();
  _factoryStores = /* @__PURE__ */ new Map();
  /** Latest live Context generation for each scoped store key. */
  _storeScopeOwners = /* @__PURE__ */ new Map();
  _renderer;
  _locale;
  _host;
  _rootContributions = [];
  _rootListeners = /* @__PURE__ */ new Set();
  _rootBinding = {
    key: void 0,
    hooks: {},
    keyedHooks: {},
    props: {}
  };
  _rootSource = {
    getSnapshot: () => this._rootBinding,
    subscribe: (listener) => {
      this._rootListeners.add(listener);
      return () => {
        this._rootListeners.delete(listener);
      };
    }
  };
  _scopes = /* @__PURE__ */ new Map();
  _scopeRevision = 0;
  _scopeListeners = /* @__PURE__ */ new Set();
  _scopeRevisionSource = {
    getSnapshot: () => this._scopeRevision,
    subscribe: (listener) => {
      this._scopeListeners.add(listener);
      return () => {
        this._scopeListeners.delete(listener);
      };
    }
  };
  /**
   * @param ctx - owning root context.
   */
  constructor(ctx) {
    super(ctx, "slots");
    this._core.onMutate((key) => {
      ctx.emit("slots/changed", key);
    });
  }
  /**
   * Install an effect for each declaration lifetime of a slot. The callback
   * runs synchronously when the declaration already exists; otherwise it runs
   * inside the declaring `register()` call after the declaration is committed.
   * Collapse disposes the effect and a later declaration runs it again.
   * Callback effects are synchronous disposers; iterable effects install
   * transactionally and dispose in reverse order. The controller belongs to
   * the caller's fiber, so plugin unload cancels a pending wait and removes any
   * active contribution.
   *
   * @param key - declared SlotMap key to depend on.
   * @param callback - creates one disposer or an iterable of disposers.
   * @returns idempotent disposer for the wait and active effect.
   * @throws callback setup failures synchronously when the slot is already declared.
   */
  inject(key, callback) {
    const ctx = this.ctx;
    const disposeController = ctx.effect(() => {
      let active;
      let activeEpoch;
      let stopped = false;
      let unsubscribe = () => {
      };
      const stop = () => {
        if (stopped) return;
        stopped = true;
        unsubscribe();
        const dispose = active;
        active = void 0;
        activeEpoch = void 0;
        dispose?.();
      };
      const reconcile = () => {
        if (stopped) return;
        const spec = this._core.specDynamic(key);
        const epoch = this._core.declarationEpoch(key);
        if (active !== void 0 && activeEpoch === epoch) return;
        const dispose = active;
        active = void 0;
        activeEpoch = void 0;
        dispose?.();
        if (spec === void 0) return;
        const disposeEffect = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`);
        active = () => {
          void disposeEffect();
        };
        activeEpoch = epoch;
      };
      const changed = () => {
        try {
          reconcile();
        } catch (error) {
          if (error?.code === "INACTIVE_EFFECT") {
            stop();
            return;
          }
          stop();
          const failure = error instanceof Error ? error : new Error(String(error));
          queueMicrotask(() => {
            throw failure;
          });
        }
      };
      unsubscribe = this._core.subscribeDeclaration(key, changed);
      try {
        reconcile();
      } catch (error) {
        stop();
        throw error;
      }
      return stop;
    }, `slots.inject(${JSON.stringify(key)})`);
    return () => {
      void disposeController();
    };
  }
  /**
   * Install the shell's renderer (ui-renderer's createSlotRenderer product).
   * Boot-once: a second install throws. Runs through the caller's ctx.effect,
   * so shell fiber unload uninstalls the renderer.
   * @param renderer - the outlet machinery implementing SlotRenderer.
   */
  install(renderer) {
    if (this._renderer !== void 0) throw new Error("slot renderer already installed (install() is boot-once)");
    this.ctx.effect(() => {
      this._renderer = renderer;
      return () => {
        if (this._renderer === renderer) this._renderer = void 0;
      };
    }, "slots.install()");
  }
  /**
   * Install the locale face backing the `t` standard seat (the locale
   * plugin's product; same boot-once discipline as the renderer install).
   * Runs through the caller's ctx.effect, so the installing fiber's unload
   * uninstalls the face.
   * @param face - namespace binder + revision observable.
   */
  installLocale(face) {
    if (this._locale !== void 0) throw new Error("locale face already installed (installLocale() is boot-once)");
    this.ctx.effect(() => {
      this._locale = face;
      return () => {
        if (this._locale === face) this._locale = void 0;
      };
    }, "slots.installLocale()");
  }
  /**
   * Contribute domain-owned root data. Hook names must be globally unique;
   * registration and disposal republish one atomic root binding.
   * @param contribution - bare sources and stable props.
   * @returns disposer owned by the caller's Cordis fiber.
   */
  provideRoot(contribution) {
    const dispose = this.ctx.effect(() => {
      this._rootContributions.push(contribution);
      try {
        this.rebuildRootBinding();
      } catch (error) {
        this._rootContributions.pop();
        throw error;
      }
      return () => {
        const index = this._rootContributions.indexOf(contribution);
        if (index === -1) return;
        this._rootContributions.splice(index, 1);
        this.rebuildRootBinding();
      };
    }, "slots.provideRoot()");
    return () => {
      void dispose();
    };
  }
  /**
   * Install the owner adapter for one strict scope. Its optional counterpart
   * resolves through the same adapter.
   * @param scope - strict scope name.
   * @param adapter - current/resolved binding source and release notifications.
   */
  installScope(scope, adapter) {
    if (this._scopes.has(scope)) throw new Error(`slot scope '${scope}' already has an adapter`);
    this.ctx.effect(() => {
      this._scopes.set(scope, adapter);
      this.publishScopeRevision();
      return () => {
        if (this._scopes.get(scope) === adapter) {
          this._scopes.delete(scope);
          this.publishScopeRevision();
        }
      };
    }, `slots.installScope(${JSON.stringify(scope)})`);
  }
  /**
   * Bind scoped Store instances to one Context generation. Rebinding the key
   * drops the previous generation's memory instances before the new owner can
   * resolve them. Cleanup never clears persisted state, which belongs to the
   * durable scope key, or drops a replacement generation's instances.
   *
   * @param binding - materialized scope identity and its owning Context.
   */
  bindStoreScope(binding) {
    const current = this._storeScopeOwners.get(binding.key);
    if (current === binding.ctx) return;
    if (current !== void 0) this.releaseStoreScope(binding.key);
    this._storeScopeOwners.set(binding.key, binding.ctx);
    binding.ctx.effect(() => () => {
      if (this._storeScopeOwners.get(binding.key) !== binding.ctx) return;
      this._storeScopeOwners.delete(binding.key);
      this.releaseStoreScope(binding.key);
    }, `slots: store scope ${binding.key}`);
  }
  /**
   * The single ctx-level render entry: the shell renders 'root'; every other
   * key renders inside components through the props renderSlot face. All
   * three guards are fail-loud boot-order checks, no fallback.
   * @param key - must be 'root' (runtime-enforced for dynamically composed callers).
   * @param owner - owner share for the root entry (the shell supplies {}).
   * @returns the rendered root tree.
   */
  renderSlot(key, owner) {
    if (key !== "root") {
      throw new Error(`ctx-level renderSlot only renders 'root' (got "${key}"); child slots render through the component props face`);
    }
    if (this._renderer === void 0) {
      throw new Error("slot renderer not installed \u2014 boot must call ctx.slots.install(createSlotRenderer()) before rendering 'root'");
    }
    if (this._core.entries("root").length === 0) {
      throw new Error("'root' has no registration \u2014 a layout entry must register into 'root' before the shell renders it");
    }
    return this._renderer.renderRoot(this.hostFace(), owner);
  }
  /**
   * Snapshot entries for a key (render-erased view; stable reference between mutations).
   * @param key - SlotMap key.
   * @returns registered entries.
   */
  entries(key) {
    return this._core.entries(key);
  }
  /**
   * Shadowing winners per cell for a key: the first live (non-abdicated)
   * entry of each cell in priority order — what outlets render; chain keys
   * pass through unchanged (election consumes every entry). The raw
   * {@link SlotRegistry.entries} view stays the inspection surface. Fresh
   * array per call, not a uSES getSnapshot source.
   * @param key - SlotMap key.
   * @returns the winning entry per occupied cell.
   */
  entriesOfSlot(key) {
    return this._core.entriesOfSlot(key);
  }
  /**
   * Export the current JSON-safe Slot and Factory declaration trees for read-only inspection.
   * @param root - exact live Slot key or `factory:<name>`; omitted returns all roots.
   * @returns selected composition trees.
   */
  snapshot(root) {
    return this._core.snapshot(root);
  }
  /**
   * Observe ordinary entry and Factory occurrence crashes through one
   * supervision channel. Fires synchronously after any ordinary-entry
   * abdication mutation. Callers own the disposer (wire it through ctx.effect
   * for fiber-lifetime cleanup, as with {@link SlotRegistry.subscribe}).
   * @param fn - called with the Slot or `factory:<name>` key, crashed
   * registration, cause, and whether an ordinary entry was retired.
   * @returns unsubscribe.
   */
  onEntryError(fn) {
    return this._core.onEntryError(fn);
  }
  /**
   * Look up a declared spec (register-declared or the built-in 'root').
   * @param key - SlotMap key.
   * @returns spec or undefined.
   */
  spec(key) {
    return this._core.spec(key);
  }
  /**
   * Subscribe to a key's registration changes (microtask-batched).
   * @param key - SlotMap key.
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(key, fn) {
    return this._core.subscribe(key, fn);
  }
  /**
   * Version counter for uSES pairing.
   * @param key - SlotMap key.
   * @returns current version.
   */
  getVersion(key) {
    return this._core.getVersion(key);
  }
  /** Delegating registration path: factory minting + registrant stamp + core write + instance-axis bookkeeping. */
  _register(options, component) {
    const store = typeof options.store === "function" ? options.store() : options.store;
    const registrant = options.registrant ?? this.ctx.fiber?.name;
    const erased = {
      ...options,
      ...store !== void 0 ? { store } : {},
      ...registrant !== void 0 ? { registrant } : {}
    };
    const dispose = this._core.register(erased, component);
    if (store !== void 0) {
      const scope = this._core.specDynamic(options.name).scope;
      this._acquire(store, scope);
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      dispose();
      if (store !== void 0) this._release(store);
    };
  }
  _registerFactory(options, component) {
    const registrant = this.ctx.fiber?.name;
    const erased = {
      ...options,
      ...registrant === void 0 ? {} : { registrant }
    };
    const dispose = this._core.registerFactory(erased, component);
    const definition = this._core.factory(options.name);
    if (definition === void 0) throw new Error(`slot factory "${options.name}" disappeared during registration`);
    if (definition.store !== void 0 && typeof definition.store !== "function") {
      this._acquire(definition.store, definition.scope);
    } else if (typeof definition.store === "function") {
      this._factoryStores.set(definition, {
        occurrences: /* @__PURE__ */ new WeakMap(),
        mounted: /* @__PURE__ */ new Map()
      });
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      dispose();
      this._factoryStores.delete(definition);
      if (definition.store !== void 0 && typeof definition.store !== "function") {
        this._release(definition.store);
      }
    };
  }
  /** Build the domain-neutral host face once; installed adapters remain live through getters. */
  hostFace() {
    if (this._host !== void 0) return this._host;
    const service = this;
    this._host = {
      subscribe: (key, fn) => this._core.subscribe(key, fn),
      getVersion: (key) => this._core.getVersion(key),
      entriesOf: (key) => this._core.entries(key),
      entriesOfSlot: (key) => this._core.entriesOfSlot(key),
      reportEntryError: (key, entry, error, info) => {
        this._core.reportEntryError(key, entry, error, info);
      },
      reportFactoryError: (name, registration, error) => {
        this._core.reportFactoryError(name, registration, error);
      },
      specOf: (key) => this._core.specDynamic(key),
      isLive: (entry) => this._core.isLive(entry),
      storeOf: (entry, scopeBinding) => entry.store === void 0 ? void 0 : this.resolveStore(entry.store, scopeBinding),
      factoryStoreOf: (definition, scopeBinding, occurrence) => this.resolveFactoryStore(definition, scopeBinding, occurrence),
      retainFactoryOccurrence: (definition, occurrence) => this.retainFactoryOccurrence(definition, occurrence),
      subscribeFactory: (name, fn) => this._core.subscribeFactory(name, fn),
      getFactoryVersion: (name) => this._core.factoryVersion(name),
      factoryOf: (name) => this._core.factory(name),
      isFactoryLive: (definition) => this._core.isFactoryLive(definition),
      root: this._rootSource,
      scopeRevision: this._scopeRevisionSource,
      scope: (scope) => service._scopes.get(scope === "session-maybe" ? "session" : scope),
      get locale() {
        return service._locale;
      }
    };
    return this._host;
  }
  /** Validate and atomically publish the current root contribution roster. */
  rebuildRootBinding() {
    const hooks = {};
    const keyedHooks = {};
    const props = {};
    const finalProps = /* @__PURE__ */ new Set();
    for (const contribution of this._rootContributions) {
      copyUnique("hook", hooks, contribution.hooks, finalProps, standardHookPropName);
      copyUnique("keyed hook", keyedHooks, contribution.keyedHooks, finalProps, standardHookPropName);
      copyUnique("prop", props, contribution.props, finalProps, (name) => name);
    }
    this._rootBinding = { key: void 0, hooks, keyedHooks, props };
    for (const listener of [...this._rootListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("root standard-source subscriber failed:", error);
      }
    }
  }
  /** Publish one installed-scope roster transition after the map is authoritative. */
  publishScopeRevision() {
    this._scopeRevision += 1;
    for (const listener of [...this._scopeListeners]) {
      try {
        listener();
      } catch (error) {
        console.error("scope-adapter subscriber failed:", error);
      }
    }
  }
  /** Resolve (create or reuse) the store instance for a registered handle under a scope key. */
  resolveStore(handle, scopeBinding) {
    const record = this._stores.get(handle);
    if (record === void 0) throw new Error("store handle is not registered (entry unloaded, or the handle never went through register)");
    let key;
    if (record.scope === "root") {
      key = ROOT_INSTANCE_KEY;
    } else {
      if (scopeBinding === void 0) throw new Error(`${record.scope} store resolution requires a session id`);
      key = scopeBinding.key;
      this.bindStoreScope(scopeBinding);
    }
    let instance = record.instances.get(key);
    if (instance === void 0) {
      instance = record.scope === "root" ? handle.create() : handle.create(key);
      record.instances.set(key, instance);
    }
    return instance;
  }
  resolveFactoryStore(definition, scopeBinding, occurrence) {
    if (!this._core.isFactoryLive(definition)) {
      throw new StaleAuthorizationError(`slot factory "${definition.name}" is not registered`);
    }
    const declaration = definition.store;
    if (declaration === void 0) return void 0;
    if (typeof declaration !== "function") {
      return this.resolveStore(declaration, scopeBinding);
    }
    const axis = this._factoryStores.get(definition);
    const scopeKey = definition.scope === "root" ? ROOT_INSTANCE_KEY : requireScopeKey(definition, scopeBinding);
    if (scopeBinding !== void 0 && definition.scope !== "root") this.bindStoreScope(scopeBinding);
    let record = axis.occurrences.get(occurrence);
    if (record === void 0) {
      const handle = declaration();
      if (handle.spec.persist !== void 0) {
        throw new SlotAssemblyError(
          `exclusive store for factory "${definition.name}" cannot declare persistence`
        );
      }
      record = { handle, instances: /* @__PURE__ */ new Map(), retainers: 0 };
      axis.occurrences.set(occurrence, record);
    }
    const existing = record.instances.get(scopeKey);
    if (existing !== void 0) return existing;
    const instance = definition.scope === "root" || scopeBinding === void 0 ? record.handle.create() : record.handle.create(scopeBinding.key);
    record.instances.set(scopeKey, instance);
    return instance;
  }
  retainFactoryOccurrence(definition, occurrence) {
    if (!this._core.isFactoryLive(definition)) return () => {
    };
    if (typeof definition.store !== "function") return () => {
    };
    const axis = this._factoryStores.get(definition);
    const record = axis.occurrences.get(occurrence);
    record.retainers += 1;
    axis.mounted.set(occurrence, record);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      record.retainers -= 1;
      if (record.retainers !== 0) return;
      axis.mounted.delete(occurrence);
    };
  }
  /** Drop every materialized non-root Store instance for one ended Context generation. */
  releaseStoreScope(key) {
    for (const record of this._stores.values()) {
      if (record.scope === "root") continue;
      record.instances.delete(key);
    }
    for (const axis of this._factoryStores.values()) {
      for (const record of axis.mounted.values()) record.instances.delete(key);
    }
  }
  /** Bind (or re-reference) a handle on the axis; cross-scope conflicts already threw in the core. */
  _acquire(handle, scope) {
    const record = this._stores.get(handle);
    if (record === void 0) {
      this._stores.set(handle, { scope, refs: 1, instances: /* @__PURE__ */ new Map() });
      return;
    }
    record.refs += 1;
  }
  /** Drop one reference; the last holder's unload drops the record (instances go with it — engine stores need no explicit dispose). */
  _release(handle) {
    const record = this._stores.get(handle);
    if (record === void 0) return;
    record.refs -= 1;
    if (record.refs !== 0) return;
    this._stores.delete(handle);
  }
};
function copyUnique(kind, target, values, finalProps, propNameOf) {
  if (values === void 0) return;
  for (const [name, value] of Object.entries(values)) {
    const propName = propNameOf(name);
    if (finalProps.has(propName)) {
      throw new Error(`duplicate root standard ${kind} '${name}' at prop '${propName}'`);
    }
    finalProps.add(propName);
    target[name] = value;
  }
}
SlotRegistry.prototype.register = function register(rawOptions, component) {
  const options = rawOptions;
  return this.ctx.effect(() => this["_register"](options, component), "slots.register()");
};
SlotRegistry.prototype.registerFactory = function registerFactory(rawOptions, component) {
  const options = rawOptions;
  return this.ctx.effect(() => this["_registerFactory"](options, component), "slots.registerFactory()");
};
function requireScopeKey(definition, binding) {
  if (binding === void 0) {
    throw new Error(`${definition.scope} factory store resolution requires a session id`);
  }
  return binding.key;
}
export {
  SlotRegistry,
  UiSession
};
