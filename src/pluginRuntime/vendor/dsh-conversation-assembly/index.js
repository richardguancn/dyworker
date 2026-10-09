// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-conversation-assembly/README.md。
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

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/assembly.ts
import { Service as Service2 } from "@deepseek-ai/cordis";

// node_modules/@deepseek-ai/dsh-util-values/lib/index.js
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
var PartialArguments = class PartialArguments2 {
  /** The view of a call with no arguments available. */
  static EMPTY = PartialArguments2.fromObject({});
  /**
  * View finished argument text without scanning it until a reader asks.
  * @param text - the complete argument JSON text.
  * @returns a sealed view.
  */
  static fromText(text) {
    const view = new PartialArguments2();
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
    const view = new PartialArguments2();
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
    if (this.object !== void 0 || text.length !== this.#size) return PartialArguments2.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return PartialArguments2.fromText(text);
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
    return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
  }
  /**
  * Check a string against a decoded UTF-16 length limit without materializing it.
  * @param key - argument name.
  * @param maxLength - decoded UTF-16 limit, floored to at least zero.
  * @returns whether the string is longer than the limit; false when absent or not a string.
  */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
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
    return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
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
      if (!this.#reads.has(id)) this.#reads.set(id, {
        completion: kind === "complete",
        answer: comparison === void 0 ? read : () => comparison(read()),
        last: comparison === void 0 ? result : comparison(result)
      });
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
    const read = entry.length ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
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
      if (text !== void 0) entry.text = {
        at: entry.end,
        length: text.length,
        text
      };
    }
    const read = entry.text ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
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
      read = {
        at: entry.start,
        length: 0,
        text: ""
      };
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
    if (entry.parsed === void 0) try {
      entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
    } catch (_error) {
      entry.invalid = true;
      this.#invalidValue = true;
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
  readString(entry, read, limit, materialize2) {
    const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize2) read.text += this.slice(read.at, read.at + length);
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
        if (materialize2) read.text += remaining.slice(0, length);
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
      } else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize2) read.text += decoded;
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
    if (this.#keyEscaped) try {
      this.#key = JSON.parse(`"${raw}"`);
    } catch (_error) {
      this.fail();
      return;
    }
    else this.#key = raw;
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
    this.open({
      kind: "value",
      start: at,
      end: -1,
      parsed: void 0,
      invalid: false
    });
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

// node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const destroy = () => {
    if ((import.meta.env ? import.meta.env.MODE : void 0) !== "production") {
      console.warn(
        "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
      );
    }
    listeners.clear();
  };
  const api = { setState, getState, subscribe, destroy };
  state = createState(setState, getState, api);
  return api;
};
var createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;

// node_modules/zustand/esm/middleware.mjs
var subscribeWithSelectorImpl = (fn) => (set2, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState = fn(set2, get, api);
  return initialState;
};
var subscribeWithSelector = subscribeWithSelectorImpl;

// node_modules/immer/dist/immer.mjs
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");
var errors = true ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (true) {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  return typeof Ctor == "function" && Function.toString.call(Ctor) === objectCtorString;
}
function each(obj, iter) {
  if (getArchtype(obj) === 0) {
    Reflect.ownKeys(obj).forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2)
    thing.set(propOrOldValue, value);
  else if (t === 3) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    obj.set = obj.add = obj.clear = obj.delete = dontMutateFrozenCollections;
  }
  Object.freeze(obj);
  if (deep)
    Object.entries(obj).forEach(([key, value]) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
function isFrozen(obj) {
  return Object.isFrozen(obj);
}
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 || state.type_ === 1)
    state.revoke_();
  else
    state.revoked_ = true;
}
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path)
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(rootScope, state, result, key, childValue, path, isSet2)
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !isFrozen(childValue)) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && Object.prototype.propertyIsEnumerable.call(targetObject, prop))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 : 0,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
  } else {
    copy = shallowCopy(value, true);
  }
  each(copy, (key, childValue) => {
    set(copy, key, currentImpl(childValue));
  });
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}
var immer = new Immer2();
var produce = immer.produce;
var produceWithPatches = immer.produceWithPatches.bind(
  immer
);
var setAutoFreeze = immer.setAutoFreeze.bind(immer);
var setUseStrictShallowCopy = immer.setUseStrictShallowCopy.bind(immer);
var applyPatches = immer.applyPatches.bind(immer);
var createDraft = immer.createDraft.bind(immer);
var finishDraft = immer.finishDraft.bind(immer);

// node_modules/@deepseek-ai/dsh-client-store/lib/index.js
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) try {
    listener(...args);
  } catch (error) {
    console.error(`${label} subscriber failed:`, error);
  }
}
function rafBatch(notify) {
  const schedule = typeof requestAnimationFrame === "function" ? (fn) => {
    requestAnimationFrame(() => {
      fn();
    });
  } : (fn) => {
    queueMicrotask(fn);
  };
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      notify();
    });
  };
}
function createSnapshotStore(init, opts) {
  const withSelector = subscribeWithSelector(() => init);
  const api = createStore()(withSelector);
  if (opts?.persist) attachPersistence(api, opts.persist.name);
  let subscribe = (fn) => api.subscribe(() => {
    notifySubscribers([fn], "[client-store]");
  });
  if (opts?.flush === "raf") {
    const listeners = /* @__PURE__ */ new Set();
    const flush = rafBatch(() => {
      notifySubscribers(listeners, "[client-store]");
    });
    api.subscribe(flush);
    subscribe = (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    };
  }
  return {
    getSnapshot: () => api.getState(),
    subscribe: (fn) => subscribe(fn),
    update: (mutator) => {
      api.setState(produce(api.getState(), (draft) => {
        mutator(draft);
      }), true);
    },
    set: (next) => {
      api.setState(devFreeze(next), true);
    }
  };
}
function attachPersistence(api, name) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(name);
    if (raw !== null) api.setState(devFreeze(JSON.parse(raw)), true);
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error);
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state));
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error);
    }
  });
}
function devFreeze(value) {
  return freeze(value, true);
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/contract/request-inspection.ts
function inspectRequestPrompt(previous, event, system) {
  const header = event.data.header;
  const rawTools = header.tools;
  const prompt = {
    config: header.config,
    system: system?.text ?? "",
    tools: Array.isArray(rawTools) ? rawTools : []
  };
  if (previous === void 0 && event.data.reason !== "initial") return { prompt };
  const systemChanged = previous !== void 0 && previous.system !== prompt.system && system?.update !== true;
  const toolsChanged = previous !== void 0 && JSON.stringify(previous.tools) !== JSON.stringify(prompt.tools);
  if (previous !== void 0 && !systemChanged && !toolsChanged) return { prompt };
  const origin = system !== void 0 && (previous === void 0 || systemChanged) ? system : event;
  return {
    prompt,
    change: {
      seq: origin.seq,
      time: origin.time,
      kind: previous === void 0 ? "initial" : systemChanged && toolsChanged ? "system-and-tools" : systemChanged ? "system" : "tools",
      ...previous === void 0 ? {} : { previous }
    }
  };
}

// node_modules/@deepseek-ai/dsh-session/lib/types/surface.js
var SURFACE_EVENT_TYPES = /* @__PURE__ */ new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result"
]);
function isSurfaceEvent(event) {
  if (!SURFACE_EVENT_TYPES.has(event.type))
    return false;
  const candidate = event;
  return candidate.surfaceOp !== void 0;
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/contract/system-prompt.ts
function inspectSystemPrompt(previous, event) {
  const op = isSurfaceEvent(event) ? event.surfaceOp : void 0;
  const firstSeq = previous?.firstSeq ?? event.seq;
  let nodes = previous?.nodes ?? [];
  let replacements = previous?.replacements ?? /* @__PURE__ */ new Map();
  const unknownEndpoint = (seq) => seq < firstSeq && !replacements.has(seq);
  const uncertain = previous?.uncertain === true || op !== void 0 && op !== "append" && (unknownEndpoint(op.startSeq) || unknownEndpoint(op.endSeq));
  if (uncertain) {
    return { firstSeq, uncertain, nodes: [], replacements: /* @__PURE__ */ new Map(), effective: void 0, introduced: void 0 };
  }
  let position = event.seq;
  if (op !== void 0 && op !== "append") {
    position = replacements.get(op.startSeq) ?? op.startSeq;
    const end = replacements.get(op.endSeq) ?? op.endSeq;
    nodes = nodes.filter((item) => item.position < position || item.position > end);
    const retained = new Map([...replacements].filter(([, value]) => value < position || value > end));
    retained.set(event.seq, position);
    replacements = retained;
  }
  const introduced = event.type === "system/message" ? {
    seq: event.seq,
    time: event.time,
    turn: event.data.turn,
    step: event.data.step,
    text: event.data.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join(""),
    update: op === "append" && previous?.nodes.some((item) => item.node.text !== "") === true
  } : void 0;
  if (introduced !== void 0) {
    nodes = [...nodes, { position, node: introduced }].sort((a, b) => a.position - b.position);
  }
  const surviving = nodes.findLast((item) => item.node.text !== "")?.node;
  const effective = surviving === previous?.nodes.findLast((item) => item.node.text !== "")?.node ? previous?.effective : introduced !== void 0 && introduced === surviving ? introduced : {
    seq: event.seq,
    time: event.time,
    turn: surviving?.turn ?? 0,
    step: surviving?.step ?? 0,
    text: surviving?.text ?? "",
    update: false
  };
  return { firstSeq, uncertain, nodes, replacements, effective, introduced };
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/contract/conversation.ts
function conversationContextKey(kind, id) {
  return `${kind.length}:${kind}${id}`;
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/group-store.ts
function sameNodeReference(left, right) {
  return left.key === right.key && left.groupPart === right.groupPart;
}
function sameEntry(left, right) {
  return left.kind === right.kind && left.key === right.key && (left.kind === "group" || right.kind === "node" && left.groupPart === right.groupPart);
}
function reuseReferences(previous, next, equal) {
  return previous === next || previous.length === next.length && previous.every((value, index) => equal(value, next[index])) ? previous : next;
}
var ConversationGroupStore = class {
  root = [];
  rootGroups = /* @__PURE__ */ new Set();
  groups = /* @__PURE__ */ new Map();
  placements = /* @__PURE__ */ new Map();
  sources = /* @__PURE__ */ new Map();
  dirty = /* @__PURE__ */ new Set();
  /** @returns the identity-stable ordered root references. */
  get entries() {
    return this.root;
  }
  groupSource(key) {
    let source = this.sources.get(key);
    if (source === void 0) {
      const publication = createSnapshotStore(this.groups.get(key));
      source = {
        publication,
        observable: {
          getSnapshot: () => this.groups.get(key),
          subscribe: (listener) => publication.subscribe(listener)
        }
      };
      this.sources.set(key, source);
    }
    return source.observable;
  }
  /**
   * Install one validated update without notifying readers.
   * @param update - root replacement and complete or incremental group records.
   * @param readNode - synchronous reader of the current target Nodes.
   */
  prepareAndInstall(update, readNode) {
    const nextRoot = update.entries === void 0 ? this.root : reuseReferences(this.root, update.entries, sameEntry);
    const nextRootGroups = nextRoot === this.root ? this.rootGroups : this.collectRootGroups(nextRoot);
    const { upserts, removes } = this.collectChanges(update);
    const replaceReferences = update.groups.kind === "replace";
    const size = this.groups.size - removes.size + [...upserts.keys()].filter((key) => !this.groups.has(key)).length;
    if (size !== nextRootGroups.size) {
      throw new Error("conversation group records and root references must correspond one-to-one");
    }
    for (const key of removes) {
      if (nextRootGroups.has(key)) throw new Error(`conversation group "${key}" is still referenced`);
    }
    for (const key of upserts.keys()) {
      if (!nextRootGroups.has(key)) throw new Error(`conversation group "${key}" has no root reference`);
    }
    if (nextRootGroups !== this.rootGroups) {
      for (const key of nextRootGroups) {
        if (!upserts.has(key) && !this.groups.has(key)) {
          throw new Error(`conversation root references missing group "${key}"`);
        }
      }
    }
    const affectedParts = /* @__PURE__ */ new Map();
    const partsOf = (key) => {
      let parts = affectedParts.get(key);
      if (parts === void 0) {
        parts = new Set(this.placements.get(key));
        affectedParts.set(key, parts);
      }
      return parts;
    };
    const removeReference = (reference) => {
      partsOf(reference.key).delete(reference.groupPart);
    };
    const addReference = (reference) => {
      if (readNode(reference.key) === void 0) {
        throw new Error(`conversation group references missing Node "${reference.key}"`);
      }
      const parts = partsOf(reference.key);
      if (parts.has(reference.groupPart) || reference.groupPart === void 0 && parts.size > 0 || parts.has(void 0)) {
        throw new Error(`conversation Node "${reference.key}" has overlapping rendering positions`);
      }
      parts.add(reference.groupPart);
    };
    if (replaceReferences || nextRoot !== this.root) {
      for (const entry of this.root) if (entry.kind === "node") removeReference(entry);
    }
    for (const key of removes) {
      for (const member of this.groups.get(key).members) removeReference(member);
    }
    for (const [key, next] of upserts) {
      const previous = this.groups.get(key);
      if (previous !== void 0 && (replaceReferences || previous.members !== next.members)) {
        for (const member of previous.members) removeReference(member);
      }
    }
    if (replaceReferences || nextRoot !== this.root) {
      for (const entry of nextRoot) if (entry.kind === "node") addReference(entry);
    }
    for (const [key, next] of upserts) {
      if (replaceReferences || this.groups.get(key)?.members !== next.members) {
        for (const member of next.members) addReference(member);
      }
    }
    for (const [key, parts] of affectedParts) {
      if (parts.size === 0) this.placements.delete(key);
      else this.placements.set(key, parts);
    }
    for (const key of removes) {
      this.groups.delete(key);
      this.dirty.add(key);
    }
    for (const [key, next] of upserts) {
      if (this.groups.get(key) === next) continue;
      this.groups.set(key, next);
      this.dirty.add(key);
    }
    this.root = nextRoot;
    this.rootGroups = nextRootGroups;
  }
  /** Publish changed group sources after all related target data has been installed. */
  publish() {
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) this.sources.get(key)?.publication.set(this.groups.get(key));
  }
  /** Remove grouping without deleting its source Nodes; publication remains deferred. */
  clear() {
    this.prepareAndInstall(
      { entries: [], groups: { kind: "replace", snapshots: [] } },
      /* v8 ignore next -- an empty replacement never reads a Node reference. */
      () => void 0
    );
  }
  collectRootGroups(entries) {
    const keys = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (entry.kind !== "group") continue;
      if (keys.has(entry.key)) throw new Error(`conversation group "${entry.key}" has duplicate root references`);
      keys.add(entry.key);
    }
    return keys;
  }
  collectChanges(update) {
    const upserts = /* @__PURE__ */ new Map();
    const removes = /* @__PURE__ */ new Set();
    const add = (snapshot) => {
      if (upserts.has(snapshot.key)) throw new Error(`conversation group "${snapshot.key}" has duplicate upserts`);
      const previous = this.groups.get(snapshot.key);
      if (previous === void 0) {
        upserts.set(snapshot.key, snapshot);
        return;
      }
      const members = reuseReferences(previous.members, snapshot.members, sameNodeReference);
      upserts.set(snapshot.key, previous.data === snapshot.data && previous.members === members ? previous : { ...snapshot, members });
    };
    switch (update.groups.kind) {
      case "replace":
        for (const snapshot of update.groups.snapshots) add(snapshot);
        for (const key of this.groups.keys()) if (!upserts.has(key)) removes.add(key);
        break;
      case "apply":
        for (const snapshot of update.groups.upserts) add(snapshot);
        for (const key of update.groups.removes) {
          if (removes.has(key)) throw new Error(`conversation group "${key}" has duplicate removals`);
          if (!this.groups.has(key)) throw new Error(`conversation group "${key}" cannot be removed because it is absent`);
          if (upserts.has(key)) throw new Error(`conversation group "${key}" cannot be upserted and removed together`);
          removes.add(key);
        }
        break;
      /* v8 ignore next 2 -- closed update union; TypeScript rejects other operation tags. */
      default:
        assertNever(update.groups);
    }
    return { upserts, removes };
  }
};

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/location-index.ts
var MutableLocationDataSource = class {
  constructor(store, key) {
    this.store = store;
    this.key = key;
    this.published = store.get(key);
  }
  listeners = /* @__PURE__ */ new Set();
  published;
  getSnapshot = () => this.store.get(this.key);
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish() {
    const next = this.getSnapshot();
    if (this.published === next) return;
    this.published = next;
    notifySubscribers(this.listeners, `[ui-conversation] Location data ${this.key}`);
  }
};
var MutableLocationDataStore = class {
  constructor(markDirty) {
    this.markDirty = markDirty;
  }
  entries = /* @__PURE__ */ new Map();
  sources = /* @__PURE__ */ new Map();
  dirtyKeys = /* @__PURE__ */ new Set();
  get(key) {
    return this.entries.get(key)?.value;
  }
  source(key) {
    let source = this.sources.get(key);
    if (source === void 0) {
      source = new MutableLocationDataSource(this, key);
      this.sources.set(key, source);
    }
    return source;
  }
  remove(owner, key) {
    const current2 = this.entries.get(key);
    if (current2?.owner !== owner) return false;
    this.entries.delete(key);
    this.changed(key);
    return true;
  }
  set(owner, key, value) {
    const current2 = this.entries.get(key);
    if (current2 !== void 0 && current2.owner !== owner) {
      throw new Error(`conversation Location data "${key}" is already owned by ${current2.owner}`);
    }
    if (current2?.value === value) return false;
    this.entries.set(key, { owner, value });
    this.changed(key);
    return true;
  }
  replace(entries) {
    const changedKeys = [];
    for (const key of /* @__PURE__ */ new Set([...this.entries.keys(), ...entries.keys()])) {
      const current2 = this.entries.get(key);
      const next = entries.get(key);
      if (current2?.owner !== next?.owner || current2?.value !== next?.value) changedKeys.push(key);
    }
    if (changedKeys.length === 0) return false;
    this.entries = new Map(entries);
    for (const key of changedKeys) this.changed(key);
    return true;
  }
  publish() {
    const dirty = [...this.dirtyKeys];
    this.dirtyKeys.clear();
    for (const key of dirty) this.sources.get(key)?.publish();
  }
  changed(key) {
    this.dirtyKeys.add(key);
    this.markDirty(this);
  }
};
var SESSION_LOCATION = { kind: "session" };
var UNRESOLVED_LOCATION = { kind: "unresolved" };
function payloadCoordinates(event) {
  const data = event.data;
  if (data.turn === null) return { session: true, location: void 0 };
  const turn = Number.isSafeInteger(data.turn) && data.turn >= 0 ? data.turn : void 0;
  const step = Number.isSafeInteger(data.step) && data.step >= 0 ? data.step : void 0;
  if (turn === void 0) return step === void 0 ? { location: void 0 } : { step, location: void 0 };
  return step === void 0 ? { turn, location: void 0 } : { turn, step, location: void 0 };
}
function sameReferences(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameStep(left, right) {
  return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data;
}
function sameTurn(left, right) {
  return left !== void 0 && left.start === right.start && left.end === right.end && left.status === right.status && left.data === right.data && sameReferences(left.steps, right.steps);
}
function sameLocation(left, right) {
  if (left === void 0 || right === void 0 || left.kind !== right.kind) return left === right;
  if (left.kind === "session" || left.kind === "unresolved") return true;
  if (right.kind === "session" || right.kind === "unresolved") return false;
  if (left.kind === "turn" || right.kind === "turn") {
    return left.kind === "turn" && right.kind === "turn" && left.turn === right.turn;
  }
  return left.turn === right.turn && left.step === right.step;
}
var ConversationLocationIndex = class {
  coordinates = /* @__PURE__ */ new Map();
  seqsByTurn = /* @__PURE__ */ new Map();
  stepsByTurn = /* @__PURE__ */ new Map();
  timeline = { turnOrder: [], turns: /* @__PURE__ */ new Map() };
  turnDataStores = /* @__PURE__ */ new Map();
  stepDataStores = /* @__PURE__ */ new Map();
  dirtyDataStores = /* @__PURE__ */ new Set();
  changedTurns = /* @__PURE__ */ new Set();
  currentTurn;
  currentStep;
  /**
   * Return the current reference-stable timeline.
   * @returns current timeline snapshot.
   */
  snapshot() {
    return this.timeline;
  }
  /**
   * Drain the Turn changes accumulated for one assembly flush.
   * @returns Turn identities changed since the preceding drain.
   */
  takeChangedTurns() {
    const turns = [...this.changedTurns];
    this.changedTurns.clear();
    return turns;
  }
  /**
   * Replace all Definition-owned Location values while preserving reader identities.
   * @param entries - complete current set of Definition-owned Location values.
   * @returns whether any published Location data changed.
   */
  replaceData(entries) {
    const turns = /* @__PURE__ */ new Map();
    const steps = /* @__PURE__ */ new Map();
    for (const { owner, data } of entries) {
      const values = data.kind === "turn" ? turns.get(data.turn) ?? /* @__PURE__ */ new Map() : steps.get(stepDataKey(data.turn, requireStep(data))) ?? /* @__PURE__ */ new Map();
      const current2 = values.get(data.key);
      if (current2 !== void 0 && current2.owner !== owner) {
        throw new Error(`conversation Location data "${data.key}" is already owned by ${current2.owner}`);
      }
      values.set(data.key, { owner, value: data.value });
      if (data.kind === "turn") turns.set(data.turn, values);
      else steps.set(stepDataKey(data.turn, requireStep(data)), values);
    }
    let changed = false;
    for (const turn of /* @__PURE__ */ new Set([...this.turnDataStores.keys(), ...turns.keys()])) {
      changed = this.mutableTurnData(turn).replace(turns.get(turn) ?? /* @__PURE__ */ new Map()) || changed;
    }
    for (const step of /* @__PURE__ */ new Set([...this.stepDataStores.keys(), ...steps.keys()])) {
      changed = this.mutableStepData(step).replace(steps.get(step) ?? /* @__PURE__ */ new Map()) || changed;
    }
    return changed;
  }
  /**
   * Apply changed Context publications without rebuilding Turn/Step membership.
   * @param changes - incremental removals and replacements from published Contexts.
   * @returns whether any published Location data changed.
   */
  applyData(changes) {
    let changed = false;
    for (const change of changes) {
      const previous = change.previous;
      if (previous === null) continue;
      changed = this.storeFor(previous).remove(change.owner, previous.key) || changed;
    }
    for (const change of changes) {
      const next = change.next;
      if (next === null) continue;
      changed = this.storeFor(next).set(change.owner, next.key, next.value) || changed;
    }
    return changed;
  }
  /** Publish committed Location-data changes to their keyed sources. */
  publishData() {
    const dirty = [...this.dirtyDataStores];
    this.dirtyDataStores.clear();
    for (const store of dirty) store.publish();
  }
  /**
   * Resolve the latest Location for one event.
   * @param event - event already ingested into this index.
   * @returns current Location, falling back to session when it has no Turn/Step affinity.
   */
  locationOf(event) {
    return this.coordinates.get(event.seq)?.location ?? SESSION_LOCATION;
  }
  /**
   * Rebuild timeline facts after replace/prepend or a boundary append.
   * @param entries - complete current window in ascending seq order.
   * @returns seqs whose resolved Location changed.
   */
  rebuild(entries) {
    const previousCoordinates = this.coordinates;
    const turns = /* @__PURE__ */ new Map();
    const coordinates = /* @__PURE__ */ new Map();
    let currentTurn;
    let currentStep;
    const turnDraft = (turn, seq) => {
      let draft = turns.get(turn);
      if (draft === void 0) {
        draft = { turn, firstSeq: seq, steps: /* @__PURE__ */ new Map() };
        turns.set(turn, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };
    const stepDraft = (turn, step, seq) => {
      const owner = turnDraft(turn, seq);
      let draft = owner.steps.get(step);
      if (draft === void 0) {
        draft = { turn, step, firstSeq: seq };
        owner.steps.set(step, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };
    for (const { event } of entries) {
      const explicit = payloadCoordinates(event);
      if (event.type === "turn/start") {
        currentTurn = event.data.turn;
        currentStep = void 0;
      }
      if (event.type === "step/start") {
        currentTurn = event.data.turn;
        currentStep = event.data.step;
      }
      if (explicit.session !== true && explicit.turn !== void 0) {
        if (currentTurn !== explicit.turn) currentStep = void 0;
        currentTurn = explicit.turn;
        if (explicit.step !== void 0) currentStep = explicit.step;
      }
      const turn = explicit.session === true ? void 0 : explicit.turn ?? currentTurn;
      const step = explicit.session === true || event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turn === currentTurn ? currentStep : void 0);
      coordinates.set(event.seq, {
        ...turn === void 0 ? {} : { turn },
        ...turn === void 0 || step === void 0 ? {} : { step },
        location: void 0
      });
      if (turn !== void 0) turnDraft(turn, event.seq);
      if (turn !== void 0 && step !== void 0) stepDraft(turn, step, event.seq);
      if (event.type === "turn/start") {
        turnDraft(event.data.turn, event.seq).start = event;
      } else if (event.type === "turn/end") {
        turnDraft(event.data.turn, event.seq).end = event;
      } else if (event.type === "step/start") {
        stepDraft(event.data.turn, event.data.step, event.seq).start = event;
      } else if (event.type === "step/end") {
        stepDraft(event.data.turn, event.data.step, event.seq).end = event;
      }
      if (event.type === "step/end" && currentTurn === event.data.turn && currentStep === event.data.step) {
        currentStep = void 0;
      }
      if (event.type === "turn/end" && currentTurn === event.data.turn) {
        currentTurn = void 0;
        currentStep = void 0;
      }
    }
    const previousTurns = this.timeline.turns;
    const nextTurns = /* @__PURE__ */ new Map();
    const orderedDrafts = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq);
    for (const draft of orderedDrafts) {
      const previousTurn = previousTurns.get(draft.turn);
      const previousSteps = new Map(previousTurn?.steps.map((step) => [step.step, step]) ?? []);
      const steps = [...draft.steps.values()].sort((left, right) => left.firstSeq - right.firstSeq).map((candidate) => {
        const value2 = {
          turn: candidate.turn,
          step: candidate.step,
          start: candidate.start,
          end: candidate.end,
          status: candidate.end !== void 0 ? "closed" : candidate.start === void 0 ? "unknown" : "open",
          data: this.stepData(candidate.turn, candidate.step)
        };
        const previous = previousSteps.get(candidate.step);
        return sameStep(previous, value2) ? previous : value2;
      });
      const value = {
        turn: draft.turn,
        start: draft.start,
        end: draft.end,
        status: draft.end !== void 0 ? "closed" : draft.start === void 0 ? "unknown" : "open",
        steps,
        data: this.turnData(draft.turn)
      };
      nextTurns.set(draft.turn, sameTurn(previousTurn, value) ? previousTurn : value);
    }
    const nextOrder = orderedDrafts.map((draft) => draft.turn);
    const turnOrder = this.timeline.turnOrder.length === nextOrder.length && this.timeline.turnOrder.every((turn, index) => turn === nextOrder[index]) ? this.timeline.turnOrder : nextOrder;
    let sameMap = previousTurns.size === nextTurns.size;
    if (sameMap) {
      for (const [turn, value] of nextTurns) {
        if (previousTurns.get(turn) !== value) {
          sameMap = false;
          break;
        }
      }
    }
    for (const turn of /* @__PURE__ */ new Set([...previousTurns.keys(), ...nextTurns.keys()])) {
      if (previousTurns.get(turn) !== nextTurns.get(turn)) this.changedTurns.add(turn);
    }
    this.timeline = sameMap && turnOrder === this.timeline.turnOrder ? this.timeline : { turnOrder, turns: nextTurns };
    this.stepsByTurn.clear();
    for (const [number, turn] of this.timeline.turns) {
      this.stepsByTurn.set(number, new Map(turn.steps.map((step) => [step.step, step])));
    }
    this.coordinates = coordinates;
    this.seqsByTurn = /* @__PURE__ */ new Map();
    for (const { event } of entries) {
      const coordinates2 = this.coordinates.get(event.seq);
      if (coordinates2.turn !== void 0) this.indexTurnSeq(coordinates2.turn, event.seq);
      coordinates2.location = this.resolve(event.seq);
    }
    this.currentTurn = currentTurn;
    this.currentStep = currentStep;
    const changed = /* @__PURE__ */ new Set();
    for (const { event } of entries) {
      if (!sameLocation(
        previousCoordinates.get(event.seq)?.location,
        this.coordinates.get(event.seq)?.location
      )) {
        changed.add(event.seq);
      }
    }
    return changed;
  }
  /**
   * Append one Turn/Step boundary while revisiting only the owning Turn.
   * @param event - contiguous tail boundary event.
   * @returns seqs whose immutable Location reference changed.
   */
  appendBoundary(event) {
    if (event.type !== "turn/start" && event.type !== "turn/end" && event.type !== "step/start" && event.type !== "step/end") {
      throw new Error(`conversation Location boundary expected, received ${event.type}`);
    }
    const explicit = payloadCoordinates(event);
    if (event.type === "turn/start") {
      this.currentTurn = event.data.turn;
      this.currentStep = void 0;
    } else if (event.type === "step/start") {
      this.currentTurn = event.data.turn;
      this.currentStep = event.data.step;
    }
    if (explicit.turn !== void 0) {
      if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
      this.currentTurn = explicit.turn;
      if (explicit.step !== void 0) this.currentStep = explicit.step;
    }
    const turnNumber = explicit.turn ?? this.currentTurn;
    if (turnNumber === void 0) throw new Error(`conversation boundary ${event.type} has no turn`);
    const stepNumber = event.type === "turn/start" || event.type === "turn/end" ? void 0 : explicit.step ?? (turnNumber === this.currentTurn ? this.currentStep : void 0);
    this.coordinates.set(event.seq, {
      turn: turnNumber,
      ...stepNumber === void 0 ? {} : { step: stepNumber },
      location: this.coordinates.get(event.seq)?.location
    });
    this.indexTurnSeq(turnNumber, event.seq);
    const previousTurn = this.timeline.turns.get(turnNumber);
    let steps = previousTurn?.steps ?? [];
    if (event.type === "step/start" || event.type === "step/end") {
      const number = event.data.step;
      const indexedSteps = this.stepsByTurn.get(turnNumber) ?? /* @__PURE__ */ new Map();
      const previousStep = indexedSteps.get(number);
      const candidate2 = {
        turn: turnNumber,
        step: number,
        start: event.type === "step/start" ? event : previousStep?.start,
        end: event.type === "step/end" ? event : previousStep?.end,
        status: event.type === "step/end" || previousStep?.end !== void 0 ? "closed" : "open",
        data: this.stepData(turnNumber, number)
      };
      const nextStep = sameStep(previousStep, candidate2) ? previousStep : candidate2;
      indexedSteps.set(number, nextStep);
      this.stepsByTurn.set(turnNumber, indexedSteps);
      const index = steps.findIndex((step) => step.step === number);
      steps = index < 0 ? [...steps, nextStep] : steps.map((step, at) => at === index ? nextStep : step);
    }
    const candidate = {
      turn: turnNumber,
      start: event.type === "turn/start" ? event : previousTurn?.start,
      end: event.type === "turn/end" ? event : previousTurn?.end,
      status: event.type === "turn/end" || previousTurn?.end !== void 0 ? "closed" : event.type === "turn/start" || previousTurn?.start !== void 0 ? "open" : "unknown",
      steps,
      data: this.turnData(turnNumber)
    };
    const turn = sameTurn(previousTurn, candidate) ? previousTurn : candidate;
    const turns = new Map(this.timeline.turns);
    turns.set(turnNumber, turn);
    const turnOrder = previousTurn === void 0 ? [...this.timeline.turnOrder, turnNumber] : this.timeline.turnOrder;
    this.timeline = { turnOrder, turns };
    if (turn !== previousTurn) this.changedTurns.add(turnNumber);
    const changed = /* @__PURE__ */ new Set();
    for (const seq of this.seqsByTurn.get(turnNumber) ?? []) {
      const coordinates = this.coordinates.get(seq);
      const previous = coordinates.location;
      const next = this.resolve(seq);
      coordinates.location = next;
      if (!sameLocation(previous, next)) changed.add(seq);
    }
    if (event.type === "step/end" && this.currentTurn === event.data.turn && this.currentStep === event.data.step) {
      this.currentStep = void 0;
    }
    if (event.type === "turn/end" && this.currentTurn === event.data.turn) {
      this.currentTurn = void 0;
      this.currentStep = void 0;
    }
    return changed;
  }
  /**
   * Index one non-boundary tail event without scanning the window or the Turn's Steps.
   * @param event - contiguous appended event.
   */
  appendNonBoundary(event) {
    const explicit = payloadCoordinates(event);
    if (explicit.session === true) {
      this.coordinates.set(event.seq, { location: SESSION_LOCATION });
      return;
    }
    if (explicit.turn !== void 0) {
      if (this.currentTurn !== explicit.turn) this.currentStep = void 0;
      this.currentTurn = explicit.turn;
      if (explicit.step !== void 0) this.currentStep = explicit.step;
    }
    const turn = explicit.turn ?? this.currentTurn;
    const step = explicit.step ?? (turn === this.currentTurn ? this.currentStep : void 0);
    const coordinates = explicit.turn !== void 0 && explicit.step !== void 0 ? explicit : {
      ...turn === void 0 ? {} : { turn },
      ...turn === void 0 || step === void 0 ? {} : { step },
      location: void 0
    };
    this.coordinates.set(event.seq, coordinates);
    if (turn !== void 0) this.indexTurnSeq(turn, event.seq);
    coordinates.location = this.resolve(event.seq);
  }
  /**
   * Remove indexed Assistant transients without rebuilding the Turn/Step timeline.
   * @param events - transient events retired by one Assistant settlement.
   */
  removeAssistantTransients(events) {
    for (const event of events) {
      const turn = this.coordinates.get(event.seq)?.turn;
      if (turn !== void 0) {
        const seqs = this.seqsByTurn.get(turn);
        seqs?.delete(event.seq);
        if (seqs?.size === 0) this.seqsByTurn.delete(turn);
      }
      this.coordinates.delete(event.seq);
    }
  }
  /**
   * Index one durable Assistant settlement inserted before an already visible tail.
   * @param event - message or attempt settlement with explicit Turn and Step coordinates.
   */
  insertAssistantSettlement(event) {
    const coordinates = {
      turn: event.data.turn,
      step: event.data.step,
      location: void 0
    };
    this.coordinates.set(event.seq, coordinates);
    this.indexTurnSeq(event.data.turn, event.seq);
    coordinates.location = this.resolve(event.seq);
  }
  indexTurnSeq(turn, seq) {
    let current2 = this.seqsByTurn.get(turn);
    if (current2 === void 0) {
      current2 = /* @__PURE__ */ new Set();
      this.seqsByTurn.set(turn, current2);
    }
    current2.add(seq);
  }
  turnData(turn) {
    return this.mutableTurnData(turn);
  }
  stepData(turn, step) {
    return this.mutableStepData(stepDataKey(turn, step));
  }
  mutableTurnData(turn) {
    const current2 = this.turnDataStores.get(turn) ?? this.createDataStore(turn);
    this.turnDataStores.set(turn, current2);
    return current2;
  }
  mutableStepData(key) {
    const current2 = this.stepDataStores.get(key) ?? this.createDataStore(Number(key.slice(0, key.indexOf(":"))));
    this.stepDataStores.set(key, current2);
    return current2;
  }
  createDataStore(turn) {
    return new MutableLocationDataStore((store) => {
      this.dirtyDataStores.add(store);
      this.changedTurns.add(turn);
    });
  }
  storeFor(data) {
    return data.kind === "turn" ? this.mutableTurnData(data.turn) : this.mutableStepData(stepDataKey(data.turn, requireStep(data)));
  }
  resolve(seq) {
    const coordinates = this.coordinates.get(seq);
    if (coordinates?.turn === void 0) return SESSION_LOCATION;
    const turn = this.timeline.turns.get(coordinates.turn);
    if (turn === void 0) return UNRESOLVED_LOCATION;
    if (coordinates.step === void 0) return { kind: "turn", turn };
    const step = this.stepsByTurn.get(coordinates.turn)?.get(coordinates.step);
    return step === void 0 ? { kind: "turn", turn } : { kind: "step", turn, step };
  }
};
function stepDataKey(turn, step) {
  return `${turn}:${step}`;
}
function requireStep(data) {
  if (data.kind === "step" && data.step !== void 0) return data.step;
  throw new Error(`conversation Step data "${data.key}" requires a step`);
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/assembler.ts
var PUBLICATION_RANK = {
  none: 0,
  "animation-frame": 1,
  immediate: 2
};
var LOCATION_DATA_SCOPES = ["step", "turn"];
function emptyLocationData() {
  return { step: null, turn: null };
}
function maximumPublication(left, right) {
  return PUBLICATION_RANK[left] >= PUBLICATION_RANK[right] ? left : right;
}
function startSeq(context) {
  return context.startSeq;
}
function insertionIndex(contexts, seq) {
  let low = 0;
  let high = contexts.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const candidate = contexts[middle];
    if (candidate !== void 0 && candidate.startSeq < seq) low = middle + 1;
    else high = middle;
  }
  return low;
}
function contextSnapshot(context) {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    matches: context.matches,
    start: context.start,
    state: context.state,
    current: context.current
  };
}
function mergeMatches(key, additions, existing) {
  const merged = [];
  let added = 0;
  let current2 = 0;
  while (added < additions.length || current2 < existing.length) {
    const left = additions[added];
    const right = existing[current2];
    if (left !== void 0 && right !== void 0 && left.event.seq === right.event.seq) {
      throw new Error(`conversation Context ${key} received duplicate Match ${left.event.seq}`);
    }
    if (right === void 0 || left !== void 0 && left.event.seq < right.event.seq) {
      merged.push(left);
      added++;
    } else {
      merged.push(right);
      current2++;
    }
  }
  return merged;
}
function conversationMatch(input, role, location) {
  return { event: input.event, role, location };
}
var NO_GROUPS = { entries: () => [], forTarget: () => void 0 };
var ConversationNodeAssembler = class {
  /**
   * @param eventDefinitions - live Event Definition registry.
   * @param viewDefinitions - live view builder registry.
   * @param groupDefinitions - optional registered grouping rules, independent of presentation modes.
   */
  constructor(eventDefinitions, viewDefinitions, groupDefinitions = NO_GROUPS) {
    this.eventDefinitions = eventDefinitions;
    this.viewDefinitions = viewDefinitions;
    this.groupDefinitions = groupDefinitions;
    this.resetViewBuilders();
  }
  contexts = /* @__PURE__ */ new Map();
  contextsByKind = /* @__PURE__ */ new Map();
  contextsBySeq = /* @__PURE__ */ new Map();
  contextsByTarget = /* @__PURE__ */ new Map();
  inputs = /* @__PURE__ */ new Map();
  locationIndex = new ConversationLocationIndex();
  dirty = /* @__PURE__ */ new Set();
  dirtyByTarget = /* @__PURE__ */ new Map();
  revised = /* @__PURE__ */ new Set();
  dependents = /* @__PURE__ */ new Map();
  views = /* @__PURE__ */ new Map();
  groups = /* @__PURE__ */ new Map();
  pendingGroupStores = /* @__PURE__ */ new Set();
  activeTargets = /* @__PURE__ */ new Set();
  hasMore = false;
  replacePending = true;
  timelineDirty = true;
  /**
   * Read the current open turn without activating a View.
   * @returns the latest turn number when its start is loaded and it remains open, otherwise undefined.
   */
  openTurn() {
    const snapshot = this.locationIndex.snapshot();
    const latest2 = snapshot.turnOrder.at(-1);
    const turn = latest2 === void 0 ? void 0 : snapshot.turns.get(latest2);
    return turn?.status === "open" && turn.start !== void 0 ? turn.turn : void 0;
  }
  /**
   * Replace the complete loaded window after open, resync, or gap repair.
   * @param entries - complete contiguous window.
   * @param hasMore - whether older history remains outside the window.
   * @returns immediate publication request.
   */
  replaceWindow(entries, hasMore) {
    this.contexts.clear();
    this.contextsByKind.clear();
    this.contextsBySeq.clear();
    this.contextsByTarget.clear();
    this.inputs.clear();
    this.dirty.clear();
    this.dirtyByTarget.clear();
    this.revised.clear();
    this.dependents.clear();
    this.hasMore = hasMore;
    const sorted = [...entries].sort((left, right) => left.event.seq - right.event.seq);
    for (const entry of sorted) this.inputs.set(entry.event.seq, entry);
    this.locationIndex.rebuild(sorted);
    this.timelineDirty = true;
    for (const entry of sorted) this.matchInput(entry);
    this.replayDependencies();
    this.revised.clear();
    for (const context of this.contexts.values()) this.markDirty(context);
    this.replacePending = true;
    return "immediate";
  }
  /**
   * Add one contiguous live tail event without scanning existing Contexts.
   * @param record - appended Session event entry.
   * @returns highest requested publication cadence.
   */
  append(record) {
    const event = record.event;
    if (this.inputs.has(event.seq)) return "none";
    if (this.revised.size > 0) this.revised.clear();
    this.inputs.set(event.seq, record);
    let publication = "none";
    if (event.type !== "assistant/live-chunk" && isLocationBoundary(event.type)) {
      const previousTimeline = this.locationIndex.snapshot();
      const changed = this.locationIndex.appendBoundary(event);
      if (this.locationIndex.snapshot() !== previousTimeline) {
        this.timelineDirty = true;
        publication = "immediate";
      }
      this.replayContexts(this.refreshMatchLocations(changed));
      if (changed.size > 0) publication = "immediate";
    } else {
      this.locationIndex.appendNonBoundary(event);
    }
    publication = maximumPublication(publication, this.matchInput(record));
    if (this.replayRevisedDependents()) publication = "immediate";
    if (this.revised.size > 0) this.revised.clear();
    return publication;
  }
  /**
   * Retire one Assistant attempt's transient matches and apply its optional durable settlement.
   * Empty Contexts retain their keys and published nodes until the loaded window is rebuilt;
   * Definitions may hide those nodes when no start remains instead of withdrawing their identities.
   * @param attemptId - process-local attempt whose transient presentation ended.
   * @param entry - durable message or attempt event committed for the stream.
   * @returns highest requested publication cadence.
   */
  settleAssistant(attemptId, entry) {
    this.revised.clear();
    const retired = [...this.inputs.values()].filter((candidate) => candidate.type === "transient" && candidate.event.data.attemptId === attemptId);
    const retiredSeqs = new Set(retired.map((candidate) => candidate.event.seq));
    const affected = /* @__PURE__ */ new Set();
    for (const seq of retiredSeqs) {
      this.inputs.delete(seq);
      for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context);
      this.contextsBySeq.delete(seq);
    }
    for (const context of affected) {
      context.matches = context.matches.filter((match) => !retiredSeqs.has(match.event.seq));
    }
    this.locationIndex.removeAssistantTransients(retired.map((candidate) => candidate.event));
    let publication = retired.length === 0 ? "none" : "immediate";
    if (entry !== void 0 && !this.inputs.has(entry.event.seq)) {
      this.inputs.set(entry.event.seq, entry);
      this.locationIndex.insertAssistantSettlement(entry.event);
      const pending = /* @__PURE__ */ new Map();
      publication = maximumPublication(publication, this.collectInput(entry, pending));
      this.applyPendingMatches(pending, affected);
    }
    this.replayContexts(affected);
    if (this.replayRevisedDependents()) publication = "immediate";
    this.revised.clear();
    return publication;
  }
  /**
   * Add an older page while preserving existing Context and view identities.
   * @param entries - newly loaded older Events.
   * @param hasMore - whether history still precedes the expanded window.
   * @returns highest requested publication cadence.
   */
  prepend(entries, hasMore) {
    this.revised.clear();
    let publication = "none";
    const previousHasMore = this.hasMore;
    const fresh = entries.filter((entry) => !this.inputs.has(entry.event.seq)).sort((left, right) => left.event.seq - right.event.seq);
    for (const entry of fresh) this.inputs.set(entry.event.seq, entry);
    this.hasMore = hasMore;
    const previousTimeline = this.locationIndex.snapshot();
    const changedLocations = this.locationIndex.rebuild(this.sortedInputs());
    if (this.locationIndex.snapshot() !== previousTimeline) this.timelineDirty = true;
    const affected = this.refreshMatchLocations(changedLocations);
    const pending = /* @__PURE__ */ new Map();
    for (const entry of fresh) {
      publication = maximumPublication(publication, this.collectInput(entry, pending));
    }
    this.applyPendingMatches(pending, affected);
    this.replayContexts(affected);
    if ((this.revised.size > 0 || previousHasMore !== hasMore) && this.replayDependencies()) {
      publication = "immediate";
    }
    if (changedLocations.size > 0) publication = "immediate";
    this.revised.clear();
    return publication;
  }
  /**
   * Rebuild against the current Registry set after a low-frequency plugin change.
   * @returns immediate publication request.
   */
  rebuildRegistry() {
    this.resetViewBuilders();
    return this.replaceWindow(this.sortedInputs(), this.hasMore);
  }
  /**
   * Materialize dirty Contexts and advance every active view builder.
   * @returns whether any view snapshot was rebuilt or incrementally applied.
   */
  flush() {
    if (!this.replacePending && this.dirty.size === 0 && !this.timelineDirty) return false;
    if (this.replacePending) {
      this.replaceLocationData();
      const updated2 = [];
      const changedTurns2 = this.locationIndex.takeChangedTurns();
      for (const target of this.activeTargets) {
        const view = this.views.get(target);
        if (view === void 0) continue;
        this.updateView(view, true, this.buildTargetNodes(target, this.contextsByTarget.get(target)), changedTurns2);
        updated2.push(view);
      }
      this.replacePending = false;
      this.dirty.clear();
      this.dirtyByTarget.clear();
      this.timelineDirty = false;
      return this.publishViews(updated2);
    }
    const updated = [];
    if (this.applyDirtyLocationData()) this.timelineDirty = true;
    const changedTurns = this.locationIndex.takeChangedTurns();
    const timelineDirty = this.timelineDirty;
    for (const target of this.activeTargets) {
      const view = this.views.get(target);
      if (view === void 0) continue;
      const builder = view.builder;
      if (builder === void 0) continue;
      const upserts = this.buildTargetUpserts(target, this.dirtyByTarget.get(target));
      if (upserts.length === 0 && !timelineDirty) continue;
      this.updateView(view, false, upserts, changedTurns);
      updated.push(view);
    }
    this.dirty.clear();
    this.dirtyByTarget.clear();
    this.timelineDirty = false;
    return this.publishViews(updated);
  }
  /**
   * Add one target to the monotonic active set and materialize its current snapshot.
   * Pending Context work is flushed before the first complete replacement.
   * @param target - registered or subsequently registered view target.
   * @returns whether any active target snapshot changed.
   */
  activateTarget(target) {
    const view = this.views.get(target);
    if (this.activeTargets.has(target)) return false;
    const published = this.flush();
    this.activeTargets.add(target);
    if (view === void 0) return published;
    this.replaceView(view);
    this.publishViews([view]);
    return true;
  }
  /**
   * Read the latest snapshot of a registered target.
   * @param target - registered view target.
   * @returns target snapshot, or undefined before registration or activation.
   */
  snapshot(target) {
    return this.views.get(target)?.snapshot;
  }
  get(target) {
    return this.snapshot(target);
  }
  grouped(target) {
    return this.groups.get(target)?.store;
  }
  /**
   * Read targets whose owners classify their latest snapshot as visible activity.
   * @returns target ids contributing visible activity.
   */
  activityTargets() {
    const active = /* @__PURE__ */ new Set();
    for (const target of this.activeTargets) {
      const view = this.views.get(target);
      if (view === void 0) continue;
      if (view.isActive?.(view.snapshot) === true) active.add(view.target);
    }
    return active;
  }
  sortedInputs() {
    return [...this.inputs.values()].sort((left, right) => left.event.seq - right.event.seq);
  }
  matchInput(input) {
    return this.dispatchInput(input, this.acceptMatch);
  }
  collectInput(input, pending) {
    return this.dispatchInput(input, (definition, id, match) => {
      const key = conversationContextKey(definition.kind, id);
      const matches = pending.get(key) ?? [];
      matches.push({ definition, id, match });
      pending.set(key, matches);
      return definition.publication?.(match) ?? "immediate";
    });
  }
  dispatchInput(input, accept) {
    const event = input.event;
    let startMatch;
    let updateMatch;
    let location;
    const matchFor = (role) => {
      location ??= this.locationIndex.locationOf(event);
      return role === "start" ? startMatch ??= conversationMatch(input, role, location) : updateMatch ??= conversationMatch(input, role, location);
    };
    let firstTarget;
    let secondTarget;
    let otherTargets;
    let publication = "none";
    const routes = this.eventDefinitions.forEvent?.(event.type);
    if (routes === void 0) {
      for (const definition of this.eventDefinitions.entries()) {
        const result = definition.match(event);
        if (result === null) continue;
        if (definition.target !== void 0 && definition.target !== firstTarget && definition.target !== secondTarget) {
          if (firstTarget === void 0) firstTarget = definition.target;
          else if (secondTarget === void 0) secondTarget = definition.target;
          else (otherTargets ??= /* @__PURE__ */ new Set()).add(definition.target);
        }
        publication = maximumPublication(publication, accept.call(this, definition, result.id, matchFor(result.role)));
      }
    } else {
      for (const { definition, match } of routes) {
        const result = match(event);
        if (result === null) continue;
        if (definition.target !== void 0 && definition.target !== firstTarget && definition.target !== secondTarget) {
          if (firstTarget === void 0) firstTarget = definition.target;
          else if (secondTarget === void 0) secondTarget = definition.target;
          else (otherTargets ??= /* @__PURE__ */ new Set()).add(definition.target);
        }
        publication = maximumPublication(publication, accept.call(this, definition, result.id, matchFor(result.role)));
      }
    }
    const fallback = this.eventDefinitions.fallbackEntry();
    const target = fallback?.target;
    if (fallback !== void 0 && target !== void 0 && target !== firstTarget && target !== secondTarget && otherTargets?.has(target) !== true) {
      const result = fallback.match(event);
      if (result !== null) {
        publication = maximumPublication(publication, accept.call(this, fallback, result.id, matchFor(result.role)));
      }
    }
    return publication;
  }
  createContext(definition, id, key) {
    const context = {
      key,
      kind: definition.kind,
      id,
      definition,
      startSeq: void 0,
      start: void 0,
      matches: [],
      state: void 0,
      revision: 0,
      current: /* @__PURE__ */ new Map(),
      locationData: emptyLocationData(),
      dependencies: /* @__PURE__ */ new Map()
    };
    this.contexts.set(key, context);
    this.indexTargetContext(context);
    return context;
  }
  acceptMatch(definition, id, match) {
    const latest2 = this.contextsByKind.get(definition.kind)?.at(-1);
    const key = latest2?.id === id ? latest2.key : conversationContextKey(definition.kind, id);
    let context = this.contexts.get(key);
    context ??= this.createContext(definition, id, key);
    const starting = match.role === "start" && context.start === void 0;
    const previous = context.matches.at(-1);
    if (previous !== void 0 && previous.event.seq >= match.event.seq) {
      throw new Error(`conversation Context ${key} received non-appended Match ${match.event.seq}`);
    }
    if (starting && context.matches.length > 0) {
      throw new Error(`conversation Context ${key} received an update before its start Match`);
    }
    context.matches.push(match);
    if (starting) {
      context.startSeq = match.event.seq;
      context.start = match;
      this.indexStartedContext(context);
    }
    let owners = this.contextsBySeq.get(match.event.seq);
    if (owners === void 0) {
      owners = [];
      this.contextsBySeq.set(match.event.seq, owners);
    }
    owners.push(context);
    if (starting) {
      this.replayContext(context);
    } else if (context.state !== void 0) {
      const typed = contextSnapshot(context);
      context.state = requireState(definition, "update", definition.update(typed, match));
      context.revision++;
      this.revised.add(context);
    }
    this.markDirty(context);
    return definition.publication?.(match) ?? "immediate";
  }
  applyPendingMatches(pending, affected) {
    for (const [key, entries] of pending) {
      const first = entries[0];
      if (first === void 0) continue;
      let context = this.contexts.get(key);
      context ??= this.createContext(first.definition, first.id, key);
      const additions = entries.map((entry) => {
        if (entry.definition !== context.definition || entry.id !== context.id) {
          throw new Error(`conversation Context ${key} received inconsistent Definition identity`);
        }
        let owners = this.contextsBySeq.get(entry.match.event.seq);
        if (owners === void 0) {
          owners = [];
          this.contextsBySeq.set(entry.match.event.seq, owners);
        }
        owners.push(context);
        return entry.match;
      }).sort((left, right) => left.event.seq - right.event.seq);
      context.matches = mergeMatches(context.key, additions, context.matches);
      affected.add(context);
      this.markDirty(context);
    }
  }
  replayContexts(contexts) {
    this.refreshStarts(contexts);
    const ordered = [...contexts].sort((left, right) => (left.startSeq ?? Number.POSITIVE_INFINITY) - (right.startSeq ?? Number.POSITIVE_INFINITY));
    for (const context of ordered) {
      if (context.start === void 0) {
        context.state = void 0;
        this.replaceDependencies(context, /* @__PURE__ */ new Map());
        context.revision++;
        this.revised.add(context);
        this.markDirty(context);
        continue;
      }
      this.replayContext(context);
    }
  }
  refreshStarts(contexts) {
    const changed = /* @__PURE__ */ new Set();
    const startsByKind = /* @__PURE__ */ new Map();
    for (const context of contexts) {
      const start = context.matches.find((match) => match.role === "start");
      if (start === context.start) continue;
      context.start = start;
      context.startSeq = start?.event.seq;
      changed.add(context);
      const starts = startsByKind.get(context.kind) ?? [];
      if (start !== void 0) starts.push(context);
      startsByKind.set(context.kind, starts);
    }
    for (const [kind, starts] of startsByKind) {
      const existing = this.contextsByKind.get(kind) ?? [];
      this.contextsByKind.set(kind, existing.filter((context) => !changed.has(context)));
      this.indexStartedContexts(kind, starts);
    }
  }
  replayContext(context) {
    const start = context.start;
    if (start === void 0) {
      context.state = void 0;
      return;
    }
    if (context.matches[0] !== start) {
      throw new Error(`conversation Context ${context.key} received an update before its start Match`);
    }
    const dependencies = /* @__PURE__ */ new Map();
    const reader = this.readerFor(start.event.seq, dependencies);
    context.state = void 0;
    context.state = requireState(
      context.definition,
      "start",
      context.definition.start(contextSnapshot(context), start, reader)
    );
    this.replaceDependencies(context, dependencies);
    for (let index = 1; index < context.matches.length; index++) {
      const match = context.matches[index];
      if (match === void 0) continue;
      const typed = contextSnapshot(context);
      context.state = requireState(
        context.definition,
        "update",
        context.definition.update(typed, match)
      );
    }
    context.revision++;
    this.revised.add(context);
    this.markDirty(context);
  }
  indexTargetContext(context) {
    const target = context.definition.target;
    if (target === void 0) return;
    const contexts = this.contextsByTarget.get(target) ?? /* @__PURE__ */ new Set();
    contexts.add(context);
    this.contextsByTarget.set(target, contexts);
  }
  markDirty(context) {
    if (this.dirty.has(context)) return;
    this.dirty.add(context);
    const target = context.definition.target;
    if (target === void 0 || !this.activeTargets.has(target)) return;
    let contexts = this.dirtyByTarget.get(target);
    if (contexts === void 0) {
      contexts = /* @__PURE__ */ new Set();
      this.dirtyByTarget.set(target, contexts);
    }
    contexts.add(context);
  }
  replaceDependencies(context, dependencies) {
    for (const dependency of context.dependencies.values()) {
      if (dependency.key === void 0) continue;
      const current2 = this.dependents.get(dependency.key);
      current2?.delete(context);
      if (current2?.size === 0) this.dependents.delete(dependency.key);
    }
    context.dependencies = dependencies;
    for (const dependency of dependencies.values()) {
      if (dependency.key === void 0) continue;
      const current2 = this.dependents.get(dependency.key) ?? /* @__PURE__ */ new Set();
      current2.add(context);
      this.dependents.set(dependency.key, current2);
    }
  }
  replayRevisedDependents() {
    if (this.dependents.size === 0) return false;
    const pending = [...this.revised];
    const affected = /* @__PURE__ */ new Set();
    for (let index = 0; index < pending.length; index++) {
      const dependency = pending[index];
      if (dependency === void 0) continue;
      for (const dependent of this.dependents.get(dependency.key) ?? []) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        pending.push(dependent);
      }
    }
    if (affected.size > 0) this.replayContexts(affected);
    return affected.size > 0;
  }
  readerFor(beforeSeq, dependencies) {
    return {
      previous: (kind) => {
        const predecessor = this.previousContext(kind, beforeSeq);
        dependencies.set(kind, {
          kind,
          key: predecessor?.key,
          revision: predecessor?.revision,
          windowGap: predecessor === void 0 && this.hasMore
        });
        if (predecessor?.state === void 0) return void 0;
        const seq = startSeq(predecessor);
        if (seq === void 0) return void 0;
        return {
          key: predecessor.key,
          kind: predecessor.kind,
          id: predecessor.id,
          startSeq: seq,
          state: predecessor.state,
          matches: predecessor.matches
        };
      }
    };
  }
  previousContext(kind, beforeSeq) {
    const candidates = this.contextsByKind.get(kind) ?? [];
    const indexBefore = insertionIndex(candidates, beforeSeq);
    for (let index = indexBefore - 1; index >= 0; index--) {
      const candidate = candidates[index];
      if (candidate?.state !== void 0) return candidate;
    }
    return void 0;
  }
  /** Insert one newly discovered start into its Definition's ordered predecessor index. */
  indexStartedContext(context) {
    const seq = context.startSeq;
    if (seq === void 0) return;
    const candidates = this.contextsByKind.get(context.kind) ?? [];
    const previous = candidates.at(-1);
    if (previous === void 0 || previous.startSeq < seq) candidates.push(context);
    else candidates.splice(insertionIndex(candidates, seq), 0, context);
    this.contextsByKind.set(context.kind, candidates);
  }
  indexStartedContexts(kind, additions) {
    if (additions.length === 0) return;
    const sorted = [...additions].sort((left, right) => left.startSeq - right.startSeq);
    const existing = this.contextsByKind.get(kind) ?? [];
    const merged = [];
    let before = 0;
    let added = 0;
    while (before < existing.length || added < sorted.length) {
      const left = existing[before];
      const right = sorted[added];
      if (right === void 0 || left !== void 0 && left.startSeq < right.startSeq) {
        merged.push(left);
        before++;
      } else {
        merged.push(right);
        added++;
      }
    }
    this.contextsByKind.set(kind, merged);
  }
  replayDependencies() {
    let replayed = false;
    const ordered = [...this.contexts.values()].filter((context) => startSeq(context) !== void 0).sort((left, right) => startSeq(left) - startSeq(right));
    for (const context of ordered) {
      if (context.state === void 0 || context.dependencies.size === 0) continue;
      const before = startSeq(context);
      if (before === void 0) continue;
      let changed = false;
      for (const dependency of context.dependencies.values()) {
        const current2 = this.previousContext(dependency.kind, before);
        const windowGap = current2 === void 0 && this.hasMore;
        if (current2?.key !== dependency.key || current2?.revision !== dependency.revision || windowGap !== dependency.windowGap) {
          changed = true;
          break;
        }
      }
      if (changed) {
        this.replayContext(context);
        replayed = true;
      }
    }
    return replayed;
  }
  refreshMatchLocations(changedSeqs) {
    const affected = /* @__PURE__ */ new Set();
    if (changedSeqs.size === 0) return affected;
    for (const seq of changedSeqs) {
      for (const context of this.contextsBySeq.get(seq) ?? []) affected.add(context);
    }
    for (const context of affected) {
      let start = context.start;
      const matches = context.matches.map((match) => {
        if (!changedSeqs.has(match.event.seq)) return match;
        if (match.role === "start") {
          const refreshed = {
            ...match,
            location: this.locationIndex.locationOf(match.event)
          };
          if (match === start) start = refreshed;
          return refreshed;
        }
        return { ...match, location: this.locationIndex.locationOf(match.event) };
      });
      context.matches = matches;
      context.start = start;
    }
    return affected;
  }
  buildNode(context, target) {
    if (context.definition.target !== target || context.definition.buildViewNode === void 0) return null;
    const node = context.definition.buildViewNode(contextSnapshot(context));
    if (node === null) return null;
    if (node.key !== context.key) {
      throw new Error(`conversation Definition "${context.kind}" returned unstable key "${node.key}"; expected "${context.key}"`);
    }
    if (node.target !== target) {
      throw new Error(`conversation Definition "${context.kind}" returned target "${node.target}" while building "${target}"`);
    }
    return node;
  }
  replaceView(view) {
    this.updateView(view, true, this.buildTargetNodes(view.target, this.contextsByTarget.get(view.target)), []);
  }
  updateView(view, replacing, nodes, changedTurns) {
    const builder = view.builder ?? view.definition.create();
    const definition = view.groupDefinition;
    if (definition !== void 0 && builder.groupInput === void 0) {
      throw new Error(`conversation group target "${view.target}" requires builder.groupInput()`);
    }
    view.builder = builder;
    const timeline = this.locationIndex.snapshot();
    const snapshot = replacing ? builder.replace({ nodes, timeline, changedTurns }) : builder.apply({ upserts: nodes, timeline, changedTurns });
    if (definition !== void 0 && builder.groupInput !== void 0) {
      let context = this.groups.get(view.target);
      const initial = context === void 0;
      if (context === void 0) {
        context = { definition, state: definition.create(), store: new ConversationGroupStore() };
      }
      const input = builder.groupInput();
      context.state = definition.update(context, input);
      const change = definition.buildGroups(context);
      if ((initial || input.kind === "replace") && (change === null || change.entries === void 0 || change.groups.kind !== "replace")) {
        throw new Error(`conversation group target "${view.target}" requires complete grouping for replacement input`);
      }
      if (change !== null) {
        context.store.prepareAndInstall(change, input.readNode);
        this.pendingGroupStores.add(context.store);
      }
      this.groups.set(view.target, context);
    }
    view.snapshot = snapshot;
  }
  publishViews(updated) {
    const changed = updated.length > 0 || this.pendingGroupStores.size > 0;
    const stores = [...this.pendingGroupStores];
    this.pendingGroupStores.clear();
    for (const view of updated) view.builder?.publish?.();
    for (const store of stores) store.publish();
    this.locationIndex.publishData();
    return changed;
  }
  buildTargetNodes(target, contexts) {
    const nodes = [];
    for (const context of contexts ?? []) {
      const node = this.buildNode(context, target);
      context.current.set(target, node);
      if (node !== null) nodes.push(node);
    }
    return nodes;
  }
  buildTargetUpserts(target, contexts) {
    const upserts = [];
    for (const context of contexts ?? []) {
      const previous = context.current.get(target) ?? null;
      const node = this.buildNode(context, target);
      if (node === null && previous !== null) {
        throw new Error(
          `conversation Definition "${context.kind}" withdrew materialized target "${target}"; return the same key with hidden visibility instead`
        );
      }
      context.current.set(target, node);
      if (node !== null) upserts.push(node);
    }
    return upserts;
  }
  buildLocationData(context, scope, previous) {
    if (context.definition.buildLocationData === void 0) return null;
    const data = context.definition.buildLocationData(contextSnapshot(context), scope, previous);
    if (data === null) return null;
    if (data.kind !== scope) {
      throw new Error(
        `conversation Definition "${context.kind}" published ${data.kind} data through its ${scope} scope`
      );
    }
    if (data.key !== context.kind) {
      throw new Error(
        `conversation Definition "${context.kind}" published Location data key "${data.key}"; expected its owned kind`
      );
    }
    if (!Number.isSafeInteger(data.turn) || data.turn < 0) {
      throw new Error(`conversation Definition "${context.kind}" published invalid turn ${data.turn}`);
    }
    if (data.kind === "step" && (!Number.isSafeInteger(data.step) || data.step < 0)) {
      throw new Error(`conversation Definition "${context.kind}" published invalid step ${String(data.step)}`);
    }
    return data;
  }
  replaceLocationData() {
    const entries = [];
    for (const scope of LOCATION_DATA_SCOPES) {
      for (const context of this.contexts.values()) {
        const data = this.buildLocationData(context, scope, context.locationData[scope]);
        context.locationData[scope] = data;
        if (data !== null) entries.push({ owner: context.key, data });
      }
      this.locationIndex.replaceData(entries);
    }
  }
  applyDirtyLocationData() {
    let changed = false;
    for (const scope of LOCATION_DATA_SCOPES) {
      const changes = [];
      for (const context of this.dirty) {
        const previous = context.locationData[scope];
        const next = this.buildLocationData(context, scope, previous);
        if (previous === next) continue;
        context.locationData[scope] = next;
        changes.push({ owner: context.key, previous, next });
      }
      changed = this.locationIndex.applyData(changes) || changed;
    }
    return changed;
  }
  resetViewBuilders() {
    const definitions = this.viewDefinitions.entries();
    const targets = new Set(definitions.map((definition) => definition.target));
    for (const [target, group] of this.groups) {
      if (!targets.has(target) || this.groupDefinitions.forTarget(target) !== group.definition) {
        group.store.clear();
        this.pendingGroupStores.add(group.store);
        this.groups.delete(target);
      }
    }
    this.views.clear();
    for (const definition of definitions) {
      const view = {
        target: definition.target,
        definition,
        groupDefinition: this.groupDefinitions.forTarget(definition.target),
        isActive: definition.isActive === void 0 ? void 0 : (snapshot) => definition.isActive?.(snapshot) === true,
        builder: void 0,
        snapshot: void 0
      };
      this.views.set(definition.target, view);
    }
    this.replacePending = true;
  }
};
function isLocationBoundary(type) {
  return type === "turn/start" || type === "turn/end" || type === "step/start" || type === "step/end";
}
function requireState(definition, phase, state) {
  if (state === void 0) {
    throw new Error(`conversation Definition "${definition.kind}" returned undefined from ${phase}()`);
  }
  return state;
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/definition-registry.ts
import { Service } from "@deepseek-ai/cordis";
var ConversationDefinitionRegistry = class {
  /** @param ctx - Context whose effects own contributed Definitions. */
  constructor(ctx) {
    this.ctx = ctx;
    Object.defineProperty(this, Service.tracker, {
      value: { property: "ctx" }
    });
  }
  definitions = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  cached = [];
  /**
   * Return reference-stable Definitions in registration order.
   * @returns current Definitions.
   */
  entries() {
    return this.cached;
  }
  /**
   * Observe low-frequency registry changes.
   * @param listener - synchronous invalidation callback.
   * @returns unsubscribe callback.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Register one uniquely keyed Definition for the caller's lifetime.
   * @param key - registry-local unique key.
   * @param definition - contributed Definition.
   * @param duplicateMessage - error raised when the key is already owned.
   * @param effectName - Cordis effect diagnostic label.
   * @returns idempotent disposer.
   */
  registerDefinition(key, definition, duplicateMessage, effectName) {
    if (this.definitions.has(key)) throw new Error(duplicateMessage);
    const owner = this.ctx;
    const dispose = owner.effect(() => {
      this.definitions.set(key, definition);
      this.refresh();
      return () => {
        if (this.definitions.get(key) !== definition) return;
        this.definitions.delete(key);
        this.refresh();
      };
    }, effectName);
    return () => {
      void dispose();
    };
  }
  /** Refresh cached entries and synchronously invalidate subscribers. */
  refresh() {
    this.cached = [...this.definitions.values()];
    notifySubscribers(this.listeners, "[ui-conversation] definition registry");
  }
};

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/event-registry.ts
var ConversationEventRegistry = class extends ConversationDefinitionRegistry {
  fallback;
  routes = /* @__PURE__ */ new Map();
  unrestricted = /* @__PURE__ */ new Set();
  tables = /* @__PURE__ */ new WeakMap();
  /**
   * Register a uniquely named business Definition for the caller's lifetime.
   * @param definition - Definition contribution.
   * @returns idempotent disposer.
   */
  register(definition) {
    assertDefinitionTarget(definition);
    return this.registerDefinition(
      definition.kind,
      this.resolve(definition),
      `conversation Definition "${definition.kind}" is already registered`,
      `uiConversation.events.register(${JSON.stringify(definition.kind)})`
    );
  }
  /**
   * Register the sole fallback used only when no ordinary Definition matches.
   * @param input - fallback Definition.
   * @returns idempotent disposer.
   */
  registerFallback(input) {
    assertDefinitionTarget(input);
    const target = input.target;
    if (target === void 0) throw new Error("conversation fallback Definition must declare a target");
    if (this.fallback !== void 0) throw new Error("conversation fallback Definition is already registered");
    const definition = this.resolve(input);
    const dispose = this.ctx.effect(() => {
      this.fallback = definition;
      this.refresh();
      return () => {
        if (this.fallback !== definition) return;
        this.fallback = void 0;
        this.refresh();
      };
    }, `uiConversation.events.registerFallback(${JSON.stringify(definition.kind)})`);
    return () => {
      void dispose();
    };
  }
  /**
   * Return the current unmatched-event fallback.
   * @returns installed fallback, when present.
   */
  fallbackEntry() {
    return this.fallback;
  }
  /**
   * Read precomputed candidates in registration order; the returned Set is borrowed read-only.
   * @param type - current event type.
   * @returns table handlers for this type together with all function-form handlers.
   */
  forEvent(type) {
    return this.routes.get(type) ?? this.unrestricted;
  }
  resolve(input) {
    if (typeof input.match === "function") return input;
    const table = new Map(Object.entries(input.match));
    const definition = {
      ...input,
      match: (event) => table.get(event.type)?.call(definition, event) ?? null
    };
    this.tables.set(definition, table);
    return definition;
  }
  refresh() {
    const routes = /* @__PURE__ */ new Map();
    const unrestricted = /* @__PURE__ */ new Set();
    for (const definition of this.definitions.values()) {
      const table = this.tables.get(definition);
      if (table === void 0) {
        const route = { definition, match: definition.match.bind(definition) };
        unrestricted.add(route);
        for (const candidates of routes.values()) candidates.add(route);
      } else {
        for (const [type, match] of table) {
          let candidates = routes.get(type);
          if (candidates === void 0) {
            candidates = new Set(unrestricted);
            routes.set(type, candidates);
          }
          candidates.add({ definition, match: match.bind(definition) });
        }
      }
    }
    this.routes = routes;
    this.unrestricted = unrestricted;
    super.refresh();
  }
};
function assertDefinitionTarget(definition) {
  if (definition.target === void 0 !== (definition.buildViewNode === void 0)) {
    throw new Error(
      `conversation Definition "${definition.kind}" must declare target and buildViewNode together`
    );
  }
}

// node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
function bytesToBase64(data) {
  let binary = "";
  const chunk = 32768;
  for (let offset = 0; offset < data.length; offset += chunk) binary += String.fromCharCode(...data.subarray(offset, offset + chunk));
  return btoa(binary);
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/historical-images.ts
var HistoricalImageCache = class {
  /**
   * @param ctx - Owning ui-conversation fiber.
   * @param sessions - Session Controller object layer.
   */
  constructor(ctx, sessions) {
    this.sessions = sessions;
    ctx.effect(() => () => {
      this.dispose();
    }, "ui-conversation historical image cache");
  }
  entries = new WeakMapWithValues();
  scopeDisposers = new WeakMapWithValues();
  urls = /* @__PURE__ */ new Set();
  disposed = false;
  /**
   * Resolve and cache one session-authorized image URL.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference.
   * @returns browser URL valid until the Session binding is released.
   */
  resolve(sessionId, attachment) {
    if (this.disposed) return Promise.reject(new Error("ui-conversation image cache is disposed"));
    const binding = this.sessions.binding(sessionId);
    if (binding === void 0) {
      return Promise.reject(new Error(`ui-conversation: unknown session "${sessionId}"`));
    }
    const entries = this.bindScope(binding);
    const key = attachment.attachmentId;
    const cached = entries.get(key);
    if (cached !== void 0) return cached.pending;
    const entry = {
      binding,
      pending: Promise.resolve("")
    };
    entries.set(key, entry);
    entry.pending = this.loadCanonical(key, entry, attachment);
    return entry.pending;
  }
  /**
   * Return an already-displayable URL without starting a read.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference.
   * @returns current preview or canonical URL when cached.
   */
  peek(sessionId, attachment) {
    const binding = this.sessions.binding(sessionId);
    return binding === void 0 ? void 0 : this.entries.get(binding)?.get(attachment.attachmentId)?.current;
  }
  /**
   * Adopt a submission preview while fetching the durable admitted bytes.
   * The preview is available synchronously, then replaced and revoked when
   * the canonical attachment read completes.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference the URL temporarily displays.
   * @param url - browser URL to adopt.
   * @returns whether the cache took ownership.
   */
  seed(sessionId, attachment, url) {
    if (this.disposed) return false;
    const binding = this.sessions.binding(sessionId);
    if (binding === void 0) return false;
    const entries = this.bindScope(binding);
    const key = attachment.attachmentId;
    if (entries.has(key)) return false;
    const entry = {
      binding,
      current: url,
      pending: Promise.resolve(url)
    };
    this.urls.add(url);
    entries.set(key, entry);
    entry.pending = this.loadCanonical(key, entry, attachment).catch((error) => {
      if (entries.get(key) === entry && entry.current === url) {
        entries.delete(key);
        this.releaseUrl(url);
      }
      throw error;
    });
    void entry.pending.catch(() => {
    });
    return true;
  }
  loadCanonical(key, entry, attachment) {
    return entry.binding.session.readAttachment(attachment.attachmentId).then((result) => {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      this.assertLive(key, entry);
      let url;
      if (typeof URL.createObjectURL !== "function") {
        url = `data:${result.value.attachment.mediaType};base64,${bytesToBase64(result.value.data)}`;
      } else {
        const bytes = Uint8Array.from(result.value.data);
        url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.attachment.mediaType }));
      }
      this.assertLive(key, entry);
      this.urls.add(url);
      const previous = entry.current;
      entry.current = url;
      if (previous !== void 0 && previous !== url) this.releaseUrl(previous);
      return url;
    }).catch((error) => {
      const entries = this.entries.get(entry.binding);
      if (entries?.get(key) === entry && entry.current === void 0) entries.delete(key);
      throw error;
    });
  }
  assertLive(key, entry) {
    if (this.disposed) throw new Error("ui-conversation image cache was disposed before loading completed");
    if (this.entries.get(entry.binding)?.get(key) !== entry) {
      throw new Error("ui-conversation image scope was released before loading completed");
    }
  }
  bindScope(binding) {
    const existing = this.entries.get(binding);
    if (existing !== void 0) return existing;
    const entries = /* @__PURE__ */ new Map();
    this.entries.set(binding, entries);
    const dispose = binding.ctx.effect(() => () => {
      this.scopeDisposers.delete(binding);
      this.release(binding, entries);
    }, "ui-conversation historical image scope");
    const release = () => {
      void dispose();
    };
    this.scopeDisposers.set(binding, release);
    return entries;
  }
  release(binding, entries) {
    if (this.entries.get(binding) === entries) this.entries.delete(binding);
    for (const entry of entries.values()) {
      if (entry.current !== void 0) this.releaseUrl(entry.current);
    }
    entries.clear();
  }
  releaseUrl(url) {
    if (!this.urls.delete(url)) return;
    revokeUrl(url);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of [...this.scopeDisposers.values]) dispose();
    this.scopeDisposers.clear();
    for (const url of this.urls) revokeUrl(url);
    this.urls.clear();
    for (const entries of this.entries.values) entries.clear();
    this.entries.clear();
  }
};
function revokeUrl(url) {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/view-registry.ts
var ConversationViewRegistry = class extends ConversationDefinitionRegistry {
  /**
   * Register a uniquely named view builder factory for the caller's lifetime.
   * @param definition - target builder contribution.
   * @returns idempotent disposer.
   */
  register(definition) {
    return this.registerDefinition(
      definition.target,
      definition,
      `conversation view target "${definition.target}" is already registered`,
      `uiConversation.views.register(${JSON.stringify(definition.target)})`
    );
  }
};

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/group-registry.ts
var ConversationGroupRegistry = class extends ConversationDefinitionRegistry {
  /**
   * @param ctx - owning plugin context.
   * @param views - registered target Builder definitions.
   */
  constructor(ctx, views) {
    super(ctx);
    this.views = views;
  }
  /**
   * Register grouping rules for an existing target.
   * @param definition - business State and grouping output for the declared target data.
   * @returns the effect-owned, idempotent registration disposer.
   */
  register(definition) {
    if (!this.views.entries().some((view) => view.target === definition.target)) {
      throw new Error(`conversation group target "${definition.target}" is not registered`);
    }
    return this.registerDefinition(
      definition.target,
      definition,
      `conversation group target "${definition.target}" is already registered`,
      `uiConversation.groups.register(${JSON.stringify(definition.target)})`
    );
  }
  /**
   * Find the grouping rules registered for one target.
   * @param target - View target.
   * @returns its grouping Definition, when registered.
   */
  forTarget(target) {
    return this.definitions.get(target);
  }
};

// vendor/dsh-conversation-assembly/packages/client/ui-conversation/src/client/conversation/assembly.ts
var BoundConversation = class {
  constructor(feed, assembler) {
    this.assembler = assembler;
    this.viewStore = assembler;
    this.snapshot = createSnapshotStore(this.currentSnapshot());
    this.openTurn = createSnapshotStore(assembler.openTurn());
    this.replace(feed.getSnapshot());
    this.disposeFeed = feed.subscribe(() => {
      this.accept(feed.getSnapshot());
    });
  }
  snapshot;
  openTurn;
  viewStore;
  targetSources = /* @__PURE__ */ new Map();
  revision = -1;
  frame;
  disposeFeed = () => {
  };
  target(target) {
    let source = this.targetSources.get(target);
    if (source === void 0) {
      const views = this.viewStore;
      source = {
        getSnapshot: () => views.get(target),
        subscribe: (listener) => {
          const unsubscribe = this.snapshot.subscribe(listener);
          this.activate(target);
          return unsubscribe;
        }
      };
      this.targetSources.set(target, source);
    }
    return source;
  }
  activate(target) {
    if (this.assembler.activateTarget(target)) this.snapshot.set(this.currentSnapshot());
    this.openTurn.set(this.assembler.openTurn());
  }
  rebuild() {
    this.publish(this.assembler.rebuildRegistry());
  }
  dispose() {
    this.cancelFrame();
    this.disposeFeed();
  }
  replace(window2) {
    this.revision = window2.revision;
    this.publish(this.assembler.replaceWindow(window2.entries, window2.hasMore));
  }
  accept(window2) {
    if (window2.revision === this.revision) return;
    if (window2.revision !== this.revision + 1 || window2.change.kind === "replace") {
      this.replace(window2);
      return;
    }
    this.revision = window2.revision;
    switch (window2.change.kind) {
      case "prepend":
        this.publish(this.assembler.prepend(window2.change.entries, window2.hasMore));
        return;
      case "append": {
        let publication = "none";
        for (const event of window2.change.entries) {
          const next = this.assembler.append(event);
          if (next === "immediate" || publication === "none") publication = next;
        }
        this.publish(publication);
        return;
      }
      case "settle-assistant":
        this.publish(this.assembler.settleAssistant(
          window2.change.attemptId,
          window2.change.entry
        ));
        return;
    }
  }
  publish(publication) {
    if (publication === "none") return;
    if (publication === "animation-frame" && typeof requestAnimationFrame === "function") {
      if (this.frame !== void 0) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = requestAnimationFrame(() => {
          this.frame = requestAnimationFrame(() => {
            this.frame = void 0;
            this.flush();
          });
        });
      });
      return;
    }
    this.cancelFrame();
    this.flush();
  }
  cancelFrame() {
    if (this.frame !== void 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frame);
    }
    this.frame = void 0;
  }
  flush() {
    if (this.assembler.flush()) this.snapshot.set(this.currentSnapshot());
    this.openTurn.set(this.assembler.openTurn());
  }
  currentSnapshot() {
    return {
      views: this.viewStore,
      activeTargets: this.assembler.activityTargets()
    };
  }
};
var UiConversation = class extends Service2 {
  /**
   * @param ctx - owning Client context.
   * @param sessions - Session Controller object layer.
   */
  constructor(ctx, sessions) {
    super(ctx, "uiConversation");
    this.sessions = sessions;
    this.events = new ConversationEventRegistry(ctx);
    this.views = new ConversationViewRegistry(ctx);
    this.groups = new ConversationGroupRegistry(ctx, this.views);
    this.images = new HistoricalImageCache(ctx, sessions);
    const rebuild = () => {
      for (const record of this.bindings.values) record.binding.rebuild();
    };
    let rebuildQueued = false;
    const scheduleRebuild = () => {
      if (rebuildQueued) return;
      rebuildQueued = true;
      queueMicrotask(() => {
        rebuildQueued = false;
        rebuild();
      });
    };
    ctx.effect(() => {
      const disposeEvents = this.events.subscribe(scheduleRebuild);
      const disposeViews = this.views.subscribe(scheduleRebuild);
      const disposeGroups = this.groups.subscribe(scheduleRebuild);
      return () => {
        disposeGroups();
        disposeViews();
        disposeEvents();
        for (const record of [...this.bindings.values]) this.drop(record, true);
      };
    }, "ui-conversation assembly");
  }
  /** Registry of event matchers and target snapshot builders. */
  events;
  /** Registry of target View definitions. */
  views;
  /** Business grouping rules over already materialized target Nodes. */
  groups;
  bindings = new WeakMapWithValues();
  images;
  /**
   * Resolve the Conversation binding for one Controller binding or Session id.
   * @param source - Session binding or identity.
   * @returns stable Conversation binding.
   * @throws if the Session is unknown or its binding is no longer current.
   */
  binding(source) {
    const sessionId = typeof source === "string" ? source : source.sessionId;
    const owner = typeof source === "string" ? this.sessions.binding(source) : source;
    if (owner === void 0) throw new Error(`uiConversation.binding: unknown session "${sessionId}"`);
    if (this.sessions.binding(sessionId) !== owner) {
      throw new Error(`uiConversation.binding: inactive session "${sessionId}"`);
    }
    const current2 = this.bindings.get(owner);
    if (current2 !== void 0) return current2.binding;
    const binding = new BoundConversation(
      owner.eventSource,
      new ConversationNodeAssembler(this.events, this.views, this.groups)
    );
    const record = { source: owner, binding, disposeScope: () => {
    } };
    this.bindings.set(owner, record);
    const disposeScope = owner.ctx.effect(
      () => () => {
        this.drop(record, false);
      },
      "ui-conversation binding"
    );
    record.disposeScope = () => {
      void disposeScope();
    };
    return binding;
  }
  /**
   * Resolve one session-authorized durable image URL, cached per Session so
   * every Conversation target shares one read and one browser URL.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns browser URL valid until the Session binding is released.
   */
  imageUrl(sessionId, attachment) {
    return this.images.resolve(sessionId, attachment);
  }
  /**
   * Read a cached durable image URL synchronously when one is available.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference from a session event.
   * @returns current preview or canonical URL, if cached.
   */
  peekImageUrl(sessionId, attachment) {
    return this.images.peek(sessionId, attachment);
  }
  /**
   * Adopt an already-displayable URL for one durable reference (see
   * HistoricalImageCache.seed): the transcript node then renders it without a
   * byte round-trip.
   * @param sessionId - Session authorization and lifetime scope.
   * @param attachment - Durable image reference the URL displays.
   * @param url - browser URL to adopt.
   * @returns whether the cache took URL ownership.
   */
  seedImageUrl(sessionId, attachment, url) {
    return this.images.seed(sessionId, attachment, url);
  }
  /**
   * Interpret a system message or surface replacement for target-owned prompt Definitions.
   * @param previous - System facts at the preceding relevant loaded event.
   * @param event - Durable system message or positional replacement.
   * @returns Immutable prompt interpretation at this event.
   */
  inspectSystemPrompt(previous, event) {
    return inspectSystemPrompt(previous, event);
  }
  /**
   * Canonicalize one `request/header` event against the previous prompt state
   * and the `system/message` node in force.
   *
   * A pure interpretation shared by the Chat and Trajectory Definitions, exposed
   * as a service method because cross-plugin value imports are forbidden in
   * client bundles.
   * @param previous - prompt recorded by the preceding loaded header, if any.
   * @param event - the `request/header` session event to interpret.
   * @param system - effective prompt after loaded surface replacements, if any.
   * @returns the canonical prompt snapshot and any model-visible change.
   */
  inspectRequestPrompt(previous, event, system) {
    return inspectRequestPrompt(previous, event, system);
  }
  drop(record, releaseScope) {
    if (this.bindings.get(record.source) !== record) return;
    this.bindings.delete(record.source);
    record.binding.dispose();
    if (releaseScope) record.disposeScope();
  }
};

// vendor/dsh-conversation-assembly/packages/api/session-controller/src/client/contract/events.ts
function leaf(entries) {
  return { kind: "leaf", entries, length: entries.length };
}
function concat(left, right) {
  return { kind: "concat", left, right, length: left.length + right.length };
}
function materialize(node) {
  if (node.kind === "leaf") return node.entries;
  const entries = new Array(node.length);
  const pending = [node];
  let index = 0;
  while (pending.length > 0) {
    const current2 = pending.pop();
    if (current2.kind === "concat") {
      pending.push(current2.right, current2.left);
      continue;
    }
    for (const entry of current2.entries) {
      entries[index] = entry;
      index += 1;
    }
  }
  return entries;
}
function windowSnapshot(node, hasMore, revision, change) {
  let entries;
  return {
    get entries() {
      entries ??= materialize(node);
      return entries;
    },
    hasMore,
    revision,
    change
  };
}
var MutableSessionEventSource = class {
  listeners = /* @__PURE__ */ new Set();
  window = leaf([]);
  snapshot = windowSnapshot(
    this.window,
    false,
    0,
    { kind: "replace", entries: [] }
  );
  /** @returns the cached event-window snapshot. */
  getSnapshot() {
    return this.snapshot;
  }
  /**
   * Subscribe to synchronous window publication.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /**
   * Replace the complete contiguous window.
   * @param entries - complete window.
   * @param hasMore - whether older history remains.
   */
  replace(entries, hasMore) {
    this.window = leaf(entries);
    this.publish(hasMore, { kind: "replace", entries });
  }
  /**
   * Prepend one older contiguous page.
   * @param entries - newly loaded older entries.
   * @param hasMore - whether still older history remains.
   */
  prepend(entries, hasMore) {
    this.window = concat(leaf(entries), this.window);
    this.publish(hasMore, { kind: "prepend", entries });
  }
  /**
   * Append one contiguous live entry.
   * @param entry - live tail entry.
   */
  append(entry) {
    const entries = [entry];
    this.window = concat(this.window, leaf(entries));
    this.publish(this.snapshot.hasMore, {
      kind: "append",
      entries
    });
  }
  /**
   * Replace one attempt's transient rows with its committed durable settlement.
   * @param attemptId - process-local attempt whose live rows are now redundant.
   * @param entry - durable settlement committed for that attempt.
   */
  settleAssistant(attemptId, entry) {
    const entries = materialize(this.window).filter((candidate) => candidate.type !== "transient" || candidate.event.data.attemptId !== attemptId);
    if (entry !== void 0) {
      const index = entries.findIndex((candidate) => candidate.event.seq > entry.event.seq);
      if (index < 0) entries.push(entry);
      else entries.splice(index, 0, entry);
    }
    this.window = leaf(entries);
    this.publish(this.snapshot.hasMore, {
      kind: "settle-assistant",
      attemptId,
      ...entry === void 0 ? {} : { entry }
    });
  }
  publish(hasMore, change) {
    this.snapshot = windowSnapshot(this.window, hasMore, this.snapshot.revision + 1, change);
    notifySubscribers(this.listeners, "[session-controller] event feed");
  }
};
export {
  MutableSessionEventSource,
  UiConversation
};
