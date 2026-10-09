// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-session-controller/README.md。
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

// node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// node_modules/@deepseek-ai/dsh-brand/lib/index.js
function brandNumber(value) {
  return value;
}

// node_modules/@deepseek-ai/dsh-session/lib/types/types.js
function SessionSeq(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
  }
  return brandNumber(value);
}
function SessionLogOffset(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
  }
  return brandNumber(value);
}

// node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js
import { Context, Service } from "@deepseek-ai/cordis";
var RemoteError = class extends Error {
  code;
  details;
  /** Structural marker: cross-realm/bundle identification never uses instanceof. */
  isDSHRemoteError = true;
  /**
  * @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
  * @param message - human diagnostic carried across the wire.
  * @param details - structured payload typed by the code.
  * @param options - standard Error options (`cause` survives in-process only).
  */
  constructor(code, message, details, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = "RemoteError";
  }
};
function remoteErrorOf(value) {
  if (typeof value === "object" && value !== null && value.isDSHRemoteError === true && typeof value.code === "string") return value;
}
var TYPERT_OWNED_VALUE = Symbol.for("dsh.typert.owned-value");

// vendor/dsh-session-controller/packages/api/gateway/src/client/stream-client.ts
var RemoteStreamCarrierError = class extends Error {
  /**
   * @param message - physical carrier failure description.
   * @param options - optional causal error.
   */
  constructor(message, options) {
    super(message, options);
    this.name = "RemoteStreamCarrierError";
  }
};

// vendor/dsh-session-controller/packages/api/gateway/src/client/journal-stream.ts
function protocolViolation(message) {
  return new RemoteError("gateway/internal", message, {});
}
var RemoteJournalStream = class {
  /**
   * @param remote - Gateway factory for the reconnecting physical-generation stream.
   * @param options - cursor algebra and domain publication sinks.
   */
  constructor(remote, options) {
    this.options = options;
    this.stream = remote.$stream({
      name: options.name,
      open: (signal) => this.follow(this.initialRequest, signal),
      ended: (accepted) => accepted ? new RemoteStreamCarrierError(`${options.name} ended without a terminal result`) : protocolViolation(
        `${this.hasResumeCursor ? "resumed " : ""}${options.name} ended before its opening cursor`
      ),
      ...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed }
    });
  }
  stream;
  initialRequest;
  resumeCursor;
  hasResumeCursor = false;
  generation = 0;
  firstCursor;
  lastCursor;
  started = false;
  opened = false;
  disposed = false;
  done;
  closing;
  pendingNext;
  /** Cancellation lifetime shared by follow and page calls. */
  get signal() {
    return this.stream.signal;
  }
  /**
   * Establish follow and publish the opening snapshot carried by its first frame.
   * @param request - initial tail-page request.
   * @returns after the first complete window is published.
   */
  async open(request) {
    if (this.started) throw new Error(`${this.options.name} already opened`);
    this.started = true;
    this.initialRequest = request;
    const iterator = this.stream[Symbol.asyncIterator]();
    try {
      const first = await this.takeNext(iterator);
      if (first.done) throw protocolViolation(`${this.options.name} ended before its opening cursor`);
      this.replaceGeneration(first.value, false);
      this.opened = true;
      this.done = this.consume(iterator);
    } catch (error) {
      await this.stream.dispose();
      throw error;
    }
  }
  /**
   * Read and prepend one older page after a successful open.
   * @param request - domain page request bound to this stream's address.
   * @returns after the page is applied or rejected as discontinuous.
   */
  async prepend(request) {
    if (!this.opened || this.disposed) throw new Error(`${this.options.name} is not open`);
    const page = await this.readPage(request, this.currentCursor(), this.stream.signal);
    this.stream.signal.throwIfAborted();
    const entries = this.options.entries(page);
    this.assertPage(entries);
    const before = this.firstCursor;
    const accepted = before === void 0 ? [...entries] : entries.filter((entry) => this.options.compare(this.options.first(entry), before) < 0);
    const tail = accepted.at(-1);
    if (tail !== void 0 && before !== void 0 && !this.options.follows(this.options.last(tail), before)) {
      this.options.publish({ type: "prepend", page, entries: [], hasMore: false });
      throw protocolViolation(`${this.options.name} history page is discontinuous`);
    }
    const first = accepted[0];
    if (first !== void 0) this.firstCursor = this.options.first(first);
    this.options.publish({
      type: "prepend",
      page,
      entries: accepted,
      hasMore: this.options.hasMore(page)
    });
  }
  /** Replace the active physical generation while retaining the published window. */
  restart() {
    this.stream.restart();
  }
  /**
   * Permanently stop follow, page requests, and the background consumer.
   * @returns when no stream work or publication callback can still run.
   */
  dispose() {
    if (this.closing !== void 0) return this.closing;
    this.disposed = true;
    const done = this.done;
    const closing = (async () => {
      await this.stream.dispose();
      await done;
    })();
    this.closing = closing;
    return closing;
  }
  async consume(iterator) {
    try {
      while (true) {
        const next = await this.takeNext(iterator);
        if (next.done) return;
        const item = next.value;
        if (item.generation !== this.generation) {
          this.replaceGeneration(item, true);
          continue;
        }
        if (item.value.type === "opened") {
          throw protocolViolation(`${this.options.name} emitted more than one opening cursor`);
        }
        if (item.value.type === "notification") {
          this.publishNotification(item.value.notification);
          continue;
        }
        await this.acceptEntry(item.value.entry, item, iterator);
      }
    } catch (error) {
      if (!this.disposed) this.options.failed(error);
    }
  }
  replaceGeneration(initial, resumed) {
    const opening = this.opening(initial, resumed);
    this.replaceFromOpening(opening.page, opening.cursor);
  }
  opening(item, resumed) {
    if (item.value.type !== "opened") {
      throw protocolViolation(`${resumed ? "resumed " : ""}${this.options.name} emitted an entry before its opening cursor`);
    }
    const cursor = item.value.cursor;
    if (resumed && this.lastCursor !== void 0 && this.options.compare(cursor, this.lastCursor) < 0) {
      throw protocolViolation(
        `${this.options.name} resumed at a cursor behind the last applied entry`
      );
    }
    this.generation = item.generation;
    item.accept();
    return { cursor, page: item.value.page };
  }
  /** Publish a generation's opening page without issuing a second Remote call. */
  replaceFromOpening(page, cursor) {
    this.assertPageThrough(page, cursor);
    const entries = [...this.options.entries(page)];
    this.assertPage(entries);
    const first = entries[0];
    this.firstCursor = first === void 0 ? void 0 : this.options.first(first);
    this.lastCursor = cursor;
    this.setResumeCursor(cursor);
    this.options.publish({
      type: "replace",
      page,
      entries,
      hasMore: this.options.hasMore(page)
    });
  }
  async acceptEntry(entry, item, iterator) {
    const { first, last: cursor } = this.entryRange(entry);
    const last = this.lastCursor;
    if (this.options.compare(cursor, last) <= 0) return;
    if (this.options.compare(first, last) <= 0) {
      throw protocolViolation(`${this.options.name} emitted a partially overlapping entry`);
    }
    if (!this.options.follows(last, first)) {
      const request = this.repairPageRequest();
      const superseded = await this.replaceThrough(
        request,
        cursor,
        item.generation,
        item.signal,
        iterator,
        [entry],
        []
      );
      if (superseded !== void 0) {
        this.replaceGeneration(superseded, true);
      }
      return;
    }
    if (this.firstCursor === void 0) this.firstCursor = first;
    this.lastCursor = cursor;
    this.setResumeCursor(cursor);
    this.options.publish({ type: "append", entry });
  }
  async replaceThrough(request, requiredCursor, generation, signal, iterator, queued, notifications) {
    let read = await this.readPageWhileFollowing(
      request,
      requiredCursor,
      generation,
      signal,
      iterator,
      queued,
      notifications
    );
    if (read.type === "superseded") return read.item;
    let page = read.page;
    this.assertPageThrough(page, requiredCursor);
    let entries = this.mergeReplacement(page, queued);
    let target = this.maxCursor(requiredCursor, queued);
    if (entries === void 0 || this.options.compare(this.tailCursor(entries), target) < 0) {
      read = await this.readPageWhileFollowing(
        this.repairPageRequest(),
        target,
        generation,
        signal,
        iterator,
        queued,
        notifications
      );
      if (read.type === "superseded") return read.item;
      page = read.page;
      this.assertPageThrough(page, target);
      entries = this.mergeReplacement(page, queued);
      target = this.maxCursor(requiredCursor, queued);
    }
    if (entries === void 0 || this.options.compare(this.tailCursor(entries), target) < 0) {
      throw protocolViolation(`${this.options.name} page did not reach its opening cursor`);
    }
    const first = entries[0];
    this.firstCursor = first === void 0 ? void 0 : this.options.first(first);
    this.lastCursor = this.tailCursor(entries);
    this.setResumeCursor(this.lastCursor);
    this.options.publish({
      type: "replace",
      page,
      entries,
      hasMore: this.options.hasMore(page)
    });
    for (const notification of notifications) {
      this.publishNotification(notification);
    }
    return void 0;
  }
  async readPageWhileFollowing(request, through, generation, signal, iterator, queued, notifications) {
    const page = this.readPage(request, through, signal).then(
      (value) => ({ type: "page", value }),
      (error) => ({ type: "page-error", error })
    );
    while (true) {
      const pending = this.nextResult(iterator);
      const next = pending.then(
        (value) => ({ type: "next", value }),
        (error) => ({ type: "next-error", error })
      );
      const result = await Promise.race([page, next]);
      if (result.type === "page") {
        signal.throwIfAborted();
        return { type: "page", page: result.value };
      }
      if (result.type === "page-error") {
        if (!signal.aborted || this.stream.signal.aborted) throw result.error;
        return this.awaitReplacementGeneration(generation, iterator, pending);
      }
      this.releaseNext();
      if (result.type === "next-error") throw result.error;
      if (result.value.done) {
        signal.throwIfAborted();
        throw protocolViolation(`${this.options.name} ended while reading its replacement page`);
      }
      const item = result.value.value;
      if (item.generation !== generation) return { type: "superseded", item };
      if (item.value.type === "opened") {
        throw protocolViolation(`${this.options.name} emitted more than one opening cursor`);
      }
      if (item.value.type === "notification") {
        notifications.push(item.value.notification);
        continue;
      }
      queued.push(item.value.entry);
    }
  }
  async awaitReplacementGeneration(generation, iterator, initial) {
    let pending = initial;
    while (true) {
      let next;
      try {
        next = await pending;
      } finally {
        this.releaseNext();
      }
      if (next.done) {
        this.stream.signal.throwIfAborted();
        throw protocolViolation(`${this.options.name} ended while replacing an aborted page generation`);
      }
      const item = next.value;
      if (item.generation !== generation) return { type: "superseded", item };
      if (item.value.type === "opened") {
        throw protocolViolation(`${this.options.name} emitted more than one opening cursor`);
      }
      pending = this.nextResult(iterator);
    }
  }
  mergeReplacement(page, queued) {
    const entries = [...this.options.entries(page)];
    this.assertPage(entries);
    for (const entry of queued) this.entryRange(entry);
    const sorted = [...queued].sort((left, right) => this.options.compare(this.options.first(left), this.options.first(right)));
    let tail = this.tailCursor(entries);
    for (const entry of sorted) {
      const first = this.options.first(entry);
      const last = this.options.last(entry);
      if (this.options.compare(last, tail) <= 0) continue;
      if (this.options.compare(first, tail) <= 0) {
        throw protocolViolation(`${this.options.name} replacement contains a partially overlapping entry`);
      }
      if (!this.options.follows(tail, first)) return void 0;
      entries.push(entry);
      tail = last;
    }
    return entries;
  }
  maxCursor(cursor, entries) {
    let result = cursor;
    for (const entry of entries) {
      const candidate = this.options.last(entry);
      if (this.options.compare(candidate, result) > 0) result = candidate;
    }
    return result;
  }
  nextResult(iterator) {
    this.pendingNext ??= iterator.next();
    return this.pendingNext;
  }
  async takeNext(iterator) {
    const pending = this.nextResult(iterator);
    try {
      return await pending;
    } finally {
      this.releaseNext();
    }
  }
  releaseNext() {
    this.pendingNext = void 0;
  }
  publishNotification(notification) {
    this.options.publish({
      type: "notification",
      notification
    });
  }
  repairPageRequest() {
    return this.repairRequest(this.initialRequest);
  }
  setResumeCursor(cursor) {
    this.resumeCursor = cursor;
    this.hasResumeCursor = true;
  }
  currentCursor() {
    return this.resumeCursor;
  }
  tailCursor(entries) {
    const tail = entries.at(-1);
    return tail === void 0 ? this.options.emptyCursor : this.options.last(tail);
  }
  assertPage(entries) {
    const iterator = entries[Symbol.iterator]();
    const first = iterator.next();
    if (first.done) return;
    let previousRange = this.entryRange(first.value);
    for (const entry of iterator) {
      const range = this.entryRange(entry);
      if (!this.options.follows(previousRange.last, range.first)) {
        throw protocolViolation(`${this.options.name} page contains discontinuous entries`);
      }
      previousRange = range;
    }
  }
  entryRange(entry) {
    const first = this.options.first(entry);
    const last = this.options.last(entry);
    if (this.options.compare(first, last) > 0) {
      throw protocolViolation(`${this.options.name} entry has an inverted cursor range`);
    }
    return { first, last };
  }
  assertPageThrough(page, through) {
    const tail = this.tailCursor(this.options.entries(page));
    if (this.options.compare(tail, through) !== 0) {
      throw protocolViolation(`${this.options.name} page did not end at its requested cursor`);
    }
  }
};

// vendor/dsh-session-controller/packages/api/gateway/src/client/snapshot-stream.ts
function protocolViolation2(message) {
  return new RemoteError("gateway/internal", message, {});
}
var RemoteSnapshotStream = class {
  /**
   * @param stream - reconnecting physical-generation stream.
   * @param options - frame discriminator and domain state destinations.
   */
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
  }
  started = false;
  disposed = false;
  done;
  /** Start the single consumer; repeated calls are inert. */
  start() {
    if (this.started) return;
    this.started = true;
    this.done = this.consume();
  }
  /** Replace the active physical generation without discarding the published snapshot. */
  restart() {
    this.stream.restart();
  }
  /**
   * Permanently stop the stream and wait for its consumer to become quiescent.
   * @returns when no generation or callback can still run.
   */
  async dispose() {
    this.disposed = true;
    await this.stream.dispose();
    await this.done;
  }
  async consume() {
    let generation = 0;
    let snapshotSeen = false;
    try {
      for await (const item of this.stream) {
        if (item.generation !== generation) {
          generation = item.generation;
          snapshotSeen = false;
        }
        if (this.options.isSnapshot(item.value)) {
          if (snapshotSeen) {
            throw protocolViolation2(`${this.options.name} emitted more than one opening snapshot`);
          }
          this.options.replace(item.value);
          snapshotSeen = true;
          item.accept();
          continue;
        }
        if (!snapshotSeen) {
          throw protocolViolation2(`${this.options.name} emitted an update before its opening snapshot`);
        }
        this.options.update(item.value);
      }
    } catch (error) {
      if (!this.disposed) this.options.failed(error);
    }
  }
};

// fixed-gateway:session-primitives
function isRemoteFailure(error) {
  return remoteErrorOf(error) !== void 0;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/history-records.ts
function historyEntries(records) {
  return records;
}
function historyRecordFirstSeq(record) {
  return record.event.seq;
}
function historyRecordLastSeq(record) {
  return record.event.seq;
}

// node_modules/@deepseek-ai/dsh-session/lib/types/known-event-types.js
var KNOWN_SESSION_EVENT_TYPES = /* @__PURE__ */ new Set([
  "agent-preset/selected",
  "agent/inbox/spliced",
  "approval/asked",
  "approval/decided",
  "approval/policy",
  "assistant/attempt",
  "assistant/message",
  "command/done",
  "command/run",
  "compaction/end",
  "compaction/prune",
  "compaction/start",
  "compaction/summary",
  "deliverables/presented",
  "developer/message",
  "feedback/message-delete",
  "feedback/message-put",
  "feedback/record",
  "goal/change",
  "hook/invoked",
  "hook/result",
  "image/offload",
  "llm/retry",
  "llm/retry-started",
  "model/selection",
  "permission/preset",
  "plan/mode",
  "request/context",
  "request/header",
  "sandbox/mode",
  "schedule/change",
  "session-log-deepseek/delivery-accepted",
  "session/end-seed",
  "session/title",
  "session/title-llm-request",
  "step/end",
  "step/start",
  "subagent/catalog",
  "subagent/descriptor",
  "subagent/model-selection-policy",
  "system/message",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "todo/write",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "tool/call",
  "tool/ptc-dispatch",
  "tool/ptc-dispatch-start",
  "tool/result",
  "turn/end",
  "turn/start",
  "user/message",
  "web/deepseek-search-llm-request",
  "workspace/changes"
]);

// node_modules/@deepseek-ai/dsh-session/lib/types/surface.js
var SURFACE_EVENT_TYPES = /* @__PURE__ */ new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result"
]);
function isSurfaceEligibleType(type) {
  return SURFACE_EVENT_TYPES.has(type);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateSessionEventData(event, subject) {
  const data = event.data;
  if (SURFACE_EVENT_TYPES.has(event.type) && isRecord(data)) {
    const message = event.type === "user/message" ? data : data["message"];
    if (isRecord(message)) {
      if (event.type === "developer/message" !== (message["role"] === "developer")) {
        throw new Error(`${subject} developer/message and developer role must occur together`);
      }
      if (message["role"] !== "developer" && Array.isArray(message["content"]) && message["content"].some((block) => isRecord(block) && (block["type"] === "tool-addition" || block["type"] === "tool-removal"))) {
        throw new Error(`${subject} tool-change blocks require developer role`);
      }
      if (event.type === "developer/message" && Array.isArray(message["content"])) {
        let hasAdditions = false;
        for (const block of message["content"]) {
          if (!isRecord(block) || block["type"] !== "tool-addition" && block["type"] !== "tool-removal")
            continue;
          if (typeof block["toolName"] !== "string" || block["toolName"].length === 0) {
            throw new Error(`${subject} ${block["type"]} requires a nonempty toolName`);
          }
          if (block["type"] === "tool-addition") {
            hasAdditions = true;
            if (Object.hasOwn(block, "tool"))
              throw new Error(`${subject} tool-addition must omit inline tool definitions`);
          }
        }
        if (hasAdditions ? !isEventSeq(data["headerSeq"]) : Object.hasOwn(data, "headerSeq")) {
          throw new Error(`${subject} requires headerSeq exactly when tool additions are present`);
        }
      }
    }
  }
  if (event.type === "request/header") {
    if (!isRecord(data))
      throw new Error(`${subject} data must be an object`);
    const header = data["header"];
    if (!isRecord(header))
      throw new Error(`${subject} header must be an object`);
    if (Object.hasOwn(header, "system"))
      throw new Error(`${subject} must omit header.system; use system/message`);
    if (Array.isArray(header["tools"]) && header["tools"].length === 0) {
      throw new Error(`${subject} must omit empty tools`);
    }
    const defaults = header["adapterDefaults"];
    if (isRecord(defaults) && Object.keys(defaults).length === 0) {
      throw new Error(`${subject} must omit empty adapterDefaults`);
    }
  } else if (event.type === "tool/result") {
    if (!isRecord(data))
      throw new Error(`${subject} data must be an object`);
    if (data["error"] === void 0)
      return;
    const message = data["message"];
    if (!isRecord(message) || message["isError"] !== true) {
      throw new Error(`${subject} error requires message.isError === true`);
    }
  }
}
function isEventSeq(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function isReplaceOp(value) {
  const op = value;
  return Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && op["op"] === "replace" && isEventSeq(op["startSeq"]) && isEventSeq(op["endSeq"]);
}
function surfaceOpOf(event) {
  const raw = event;
  if (!isSurfaceEligibleType(event.type)) {
    if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true)
      return;
    if (raw.surfaceOp !== void 0) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
    }
    if (raw.sourceEventSeqs !== void 0) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`);
    }
    return;
  }
  const op = raw.surfaceOp;
  if (op === void 0) {
    throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
  }
  if (op === "append")
    return op;
  if (op === null || typeof op !== "object" || Array.isArray(op)) {
    throw new Error(`session event "${event.type}" carries an invalid surfaceOp`);
  }
  if (!isReplaceOp(op)) {
    throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`);
  }
  return op;
}
function assertSourceEventReferences(event, shadowedSeqs) {
  const raw = event.sourceEventSeqs;
  if (event.type === "assistant/message" && raw !== void 0) {
    throw new Error("assistant/message embeds its source stream and cannot carry sourceEventSeqs");
  }
  const sources = /* @__PURE__ */ new Set();
  if (raw !== void 0) {
    if (!Array.isArray(raw)) {
      throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`);
    }
    if (raw.length === 0) {
      throw new Error("sourceEventSeqs must not be empty");
    }
    let nonEarlierSource;
    for (const source of raw) {
      if (!isEventSeq(source)) {
        throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`);
      }
      sources.add(source);
      if (nonEarlierSource === void 0 && source >= event.seq)
        nonEarlierSource = source;
    }
    if (sources.size !== raw.length) {
      throw new Error("sourceEventSeqs must not contain duplicates");
    }
    if (nonEarlierSource !== void 0) {
      throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`);
    }
  }
  const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
  if (missing.length > 0) {
    throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(", ")}`);
  }
}
function validateSurfaceMetadata(event) {
  const op = surfaceOpOf(event);
  if (op !== void 0 && op !== "append" && (op.startSeq >= event.seq || op.endSeq >= event.seq)) {
    throw new Error(`surface replace at seq ${event.seq}: startSeq and endSeq must reference earlier events`);
  }
  if (op !== void 0)
    assertSourceEventReferences(event, []);
  return op;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/session-wire-event.ts
function assertSessionWireEvent(value) {
  const subject = "session wire event";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${subject} must be an object`);
  }
  const event = value;
  for (const key of Object.keys(event)) {
    switch (key) {
      case "type":
      case "seq":
      case "time":
      case "data":
      case "ignorable":
      case "surfaceOp":
      case "sourceEventSeqs":
        break;
      default:
        throw new Error(`${subject} has unexpected field ${key}`);
    }
  }
  const seq = event["seq"];
  if (typeof event["type"] !== "string" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0) || typeof event["time"] !== "number" || !Number.isSafeInteger(event["time"]) || !Object.hasOwn(event, "data") || event["data"] === void 0 || Object.hasOwn(event, "ignorable") && event["ignorable"] !== true) {
    throw new Error(`${subject} has an invalid envelope`);
  }
  const current2 = event;
  validateSurfaceMetadata(current2);
  validateSessionEventData(current2, subject);
}

// vendor/dsh-session-controller/packages/api/session-controller/src/types.ts
var SESSION_SEARCH_RESULT_LIMIT = 20;

// vendor/dsh-session-controller/packages/api/session-controller/src/client/transport.ts
function toSessionJournalChange(change) {
  switch (change.type) {
    case "replace":
    case "prepend":
      return { ...change, entries: historyEntries(change.entries) };
    case "append": {
      return {
        type: "append",
        entry: change.entry
      };
    }
    case "notification":
      return { type: "assistant-stream", frame: change.notification };
  }
}
function createSessionControlStream(remote, options) {
  const stream = remote.$stream({
    name: "session control stream",
    open: (signal) => remote.session.control(signal),
    ended: (accepted) => accepted ? new RemoteStreamCarrierError("session control stream ended without a terminal result") : new Error("session control stream ended before its opening snapshot"),
    ...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed }
  });
  return new RemoteSnapshotStream(stream, {
    name: "session control stream",
    isSnapshot: (frame) => frame.type === "baseline",
    replace: options.accept,
    update: options.accept,
    failed: options.failed
  });
}
var SessionEventStream = class extends RemoteJournalStream {
  /**
   * @param remote - generated Session namespace and Gateway stream factory.
   * @param address - durable ordinary-Session or direct-subagent address.
   * @param options - Session event-window destinations.
   */
  constructor(remote, address, options) {
    super(remote, {
      name: "session event stream",
      emptyCursor: -1,
      entries: (page) => page.records,
      hasMore: (page) => page.hasMore,
      first: historyRecordFirstSeq,
      last: historyRecordLastSeq,
      compare: (left, right) => left - right,
      follows: (left, right) => right === left + 1,
      publish: (change) => {
        options.publish(toSessionJournalChange(change));
      },
      ...options.carrierFailed === void 0 ? {} : { carrierFailed: options.carrierFailed },
      failed: options.failed
    });
    this.remote = remote;
    this.address = address;
  }
  /** @inheritdoc */
  async *follow(request, signal) {
    let assistantRevision;
    for await (const frame of this.remote.session.follow({
      address: this.address,
      assistantStream: true,
      ...this.repairRequest(request)
    }, signal)) {
      if (frame.type === "snapshot") {
        for (const record of frame.records) assertSessionWireEvent(record.event);
        if (frame.assistantStream === void 0) {
          throw new RemoteError(
            "gateway/internal",
            "session assistant stream omitted its opted-in opening baseline",
            {}
          );
        }
        assistantRevision = frame.assistantStream.revision;
        yield {
          type: "opened",
          cursor: frame.cursor,
          page: {
            records: frame.records,
            hasMore: frame.hasMore,
            projections: frame.projections,
            assistantStream: frame.assistantStream
          }
        };
        continue;
      }
      if (frame.type === "assistant-stream") {
        const expected = (assistantRevision ?? 0) + 1;
        if (frame.frame.revision !== expected) {
          throw new RemoteStreamCarrierError(
            `session assistant stream skipped revision ${String(expected)}`
          );
        }
        assistantRevision = frame.frame.revision;
        yield { type: "notification", notification: frame.frame };
        continue;
      }
      assertSessionWireEvent(frame.event);
      yield { type: "entry", entry: frame };
    }
  }
  /** @inheritdoc */
  async readPage(request, throughSeq, signal) {
    const result = await this.remote.session.page(
      { address: this.address, throughSeq, ...request },
      signal
    );
    if (!result.ok) throw result.error;
    for (const record of result.value.records) assertSessionWireEvent(record.event);
    return result.value;
  }
  /** @inheritdoc */
  repairRequest(request) {
    return {
      ...request.maxMessages === void 0 ? {} : { maxMessages: request.maxMessages },
      ...request.turnWindow === void 0 ? {} : { turnWindow: request.turnWindow }
    };
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

// vendor/dsh-session-controller/packages/api/session-controller/src/client/contract/events.ts
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

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/notifier.ts
var Notifier = class {
  /** @param rebuild - snapshot rebuild function injected by the owner (writes the owner's snapshotCache). */
  constructor(rebuild) {
    this.rebuild = rebuild;
  }
  listeners = /* @__PURE__ */ new Set();
  dirty = false;
  notifyPending = false;
  scheduled = "none";
  scheduleGeneration = 0;
  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Mark the snapshot dirty and notify in a microtask. */
  markDirty() {
    this.dirty = true;
    this.notifyPending = true;
    if (this.scheduled === "microtask") return;
    this.schedule("microtask");
  }
  /** Mark the snapshot dirty and publish cumulative state at most once per frame. */
  markFrameDirty() {
    this.dirty = true;
    this.notifyPending = true;
    if (this.scheduled !== "none") return;
    this.schedule(typeof globalThis.requestAnimationFrame === "function" ? "frame" : "microtask");
  }
  /**
   * Synchronous flush: controlled-input writes must notify in the same tick as
   * onChange, or React rolls the DOM back to the stale value and the caret jumps to the end.
   */
  notifyNow() {
    this.dirty = true;
    this.notifyPending = true;
    this.invalidateSchedule();
    this.flush();
  }
  /**
   * Pre-getSnapshot check: rebuild synchronously when dirty (read path
   * before first subscribe / while unobserved). Notification stays pending.
   */
  ensureFresh() {
    if (!this.dirty) return;
    this.dirty = false;
    this.rebuild();
  }
  schedule(kind) {
    const generation = ++this.scheduleGeneration;
    this.scheduled = kind;
    const publish = () => {
      if (generation !== this.scheduleGeneration) return;
      this.scheduled = "none";
      this.flush();
    };
    if (kind === "frame") {
      globalThis.requestAnimationFrame(publish);
    } else {
      queueMicrotask(publish);
    }
  }
  invalidateSchedule() {
    this.scheduleGeneration++;
    this.scheduled = "none";
  }
  flush() {
    if (!this.notifyPending) return;
    if (this.listeners.size === 0) return;
    this.notifyPending = false;
    if (this.dirty) {
      this.dirty = false;
      this.rebuild();
    }
    notifySubscribers(this.listeners, "[session-controller]");
  }
};

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/projection-store.ts
var ProjectionValueStore = class {
  rows = /* @__PURE__ */ new Map();
  channels = /* @__PURE__ */ new Map();
  valuesCache;
  /** Coarse any-key channel (no snapshot cache to rebuild: reads hit rows directly). */
  anyNotifier = new Notifier(() => {
  });
  /**
   * Key-addressed bare observable face (the useProjection resolution path).
   * Always defined — absence is an `undefined` snapshot, never a missing
   * face, so a component may subscribe before the key ever carries a value.
   * @param key - projection key.
   * @returns the identity-stable face for this key.
   */
  faceOf(key) {
    return this.channel(key).face;
  }
  /**
   * Current whole value for a key (erased framework read; typed reads go
   * through `useProjection`'s map lookup).
   * @param key - projection key.
   * @returns the value, or undefined while the key is absent.
   */
  get(key) {
    return this.rows.get(key)?.value;
  }
  /**
   * Read the accepted Host watermark without subscribing or copying a value.
   * @param key - projection key.
   * @returns the current sequence, or undefined for absent and cached values.
   */
  seqOf(key) {
    const row = this.rows.get(key);
    return row?.kind === "sequenced" ? row.seq : void 0;
  }
  /**
   * Read every current projection value as one reference-stable snapshot.
   * @returns The same frozen value map until a row changes.
   */
  values() {
    if (this.valuesCache === void 0) {
      this.valuesCache = Object.freeze(Object.fromEntries(
        [...this.rows].map(([key, row]) => [key, row.value])
      ));
    }
    return this.valuesCache;
  }
  /**
   * Subscribe to any-key changes (microtask-batched) — the manager's list
   * rebuild channel.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribeAny(listener) {
    return this.anyNotifier.subscribe(listener);
  }
  /**
   * Apply one finished value from the Session control stream.
   * @param key - projection key.
   * @param value - whole value computed by the host unit.
   * @param seq - the unit's watermark at emission.
   */
  apply(key, value, seq) {
    const row = this.rows.get(key);
    if (row?.kind === "sequenced" && seq <= row.seq) return;
    this.rows.set(key, { kind: "sequenced", value, seq });
    this.changed(key);
  }
  /**
   * Fill keys from a session-list block the Host labeled `cached`: a zero-I/O
   * view of the persisted checkpoint. A cached value lands only where no
   * sequenced row exists: a connected Session has already answered for such
   * a key, and the list's view of the persisted checkpoint cannot be newer
   * than it.
   * @param values - whole values by key viewed from the persisted checkpoint.
   */
  applyCached(values) {
    for (const key of Object.keys(values)) {
      if (this.rows.get(key)?.kind === "sequenced") continue;
      this.rows.set(key, { kind: "cached", value: values[key] });
      this.changed(key);
    }
  }
  /**
   * Seed from a history tail page's projections block. Every cached row is
   * discarded first, regardless of seq: the block comes from the connected
   * Session, and a value viewed from the persisted checkpoint never outranks
   * it. Then every carried key lands under the same seq rule as frames, and a
   * key the block omits is capability-absent as of the cut — its row clears
   * unless a newer frame already superseded the cut (a stale baseline can
   * neither overwrite nor clear newer sequenced values).
   * @param baseline - the response's projections block.
   */
  seed(baseline) {
    for (const [key, row] of this.rows) {
      if (row.kind !== "cached") continue;
      this.rows.delete(key);
      this.changed(key);
    }
    const values = baseline.values;
    for (const key of Object.keys(values)) this.apply(key, values[key], baseline.asOfSeq);
    for (const [key, row] of this.rows) {
      if (Object.hasOwn(values, key)) continue;
      if (row.kind === "sequenced" && row.seq > baseline.asOfSeq) continue;
      this.rows.delete(key);
      this.changed(key);
    }
  }
  /** Discard one Host generation's values and watermarks while preserving subscribed faces. */
  clear() {
    for (const key of this.rows.keys()) {
      this.rows.delete(key);
      this.changed(key);
    }
  }
  changed(key) {
    this.valuesCache = void 0;
    this.channels.get(key)?.notifier.markDirty();
    this.anyNotifier.markDirty();
  }
  channel(key) {
    let channel = this.channels.get(key);
    if (channel === void 0) {
      const notifier = new Notifier(() => {
      });
      channel = {
        notifier,
        face: {
          getSnapshot: () => this.rows.get(key)?.value,
          subscribe: (listener) => notifier.subscribe(listener)
        }
      };
      this.channels.set(key, channel);
    }
    return channel;
  }
};

// vendor/dsh-session-controller/packages/api/session-controller/src/client/time-zone.ts
function resolvedClientTimeZone() {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof timeZone !== "string" || timeZone.length === 0) {
    throw new Error("browser time zone is unavailable");
  }
  return timeZone;
}

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
function hasIntrinsicConstructor(prototype, name) {
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name === "Array" ? Array : Object);
  } catch {
    return false;
  }
}
function isIntrinsicObjectPrototype(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
function hasPlainArrayPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
  const objectPrototype = Object.getPrototypeOf(prototype);
  return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
function hasPlainObjectPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
}
function enumerableStringKeys(value) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
  return keys;
}
function walkJsonValue(value, detach) {
  const ancestors = /* @__PURE__ */ new Set();
  let root;
  const assign = (destination, item) => {
    if (destination === void 0) return;
    if (destination.kind === "root") root = item;
    else if (destination.kind === "array") destination.target[destination.index] = item;
    else Object.defineProperty(destination.target, destination.key, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true
    });
  };
  const tasks = [{
    kind: "visit",
    value,
    ...detach ? { destination: { kind: "root" } } : {}
  }];
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === "leave") {
      ancestors.delete(task.source);
      continue;
    }
    if (task.kind === "array-item") {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
      tasks.push({
        kind: "visit",
        value: task.source[task.index],
        ...task.target === void 0 ? {} : { destination: {
          kind: "array",
          target: task.target,
          index: task.index
        } }
      });
      continue;
    }
    if (task.kind === "object-property") {
      tasks.push({
        kind: "visit",
        value: task.source[task.key],
        ...task.target === void 0 ? {} : { destination: {
          kind: "object",
          target: task.target,
          key: task.key
        } }
      });
      continue;
    }
    const current2 = task.value;
    if (current2 === null) {
      assign(task.destination, null);
      continue;
    }
    if (typeof current2 === "boolean" || typeof current2 === "string") {
      assign(task.destination, current2);
      continue;
    }
    if (typeof current2 === "number") {
      if (!Number.isFinite(current2) || Object.is(current2, -0)) return void 0;
      assign(task.destination, current2);
      continue;
    }
    if (typeof current2 !== "object") return void 0;
    if (ancestors.has(current2)) return void 0;
    if (Array.isArray(current2)) {
      if (!hasPlainArrayPrototype(current2)) return void 0;
      const length = current2.length;
      if (Reflect.ownKeys(current2).length !== length + 1) return void 0;
      const target2 = detach ? [] : void 0;
      if (target2 !== void 0) assign(task.destination, target2);
      ancestors.add(current2);
      tasks.push({
        kind: "leave",
        source: current2
      });
      for (let index = length - 1; index >= 0; index--) tasks.push({
        kind: "array-item",
        source: current2,
        index,
        ...target2 === void 0 ? {} : { target: target2 }
      });
      continue;
    }
    if (!hasPlainObjectPrototype(current2)) return void 0;
    const keys = enumerableStringKeys(current2);
    if (keys === void 0) return void 0;
    const target = detach ? {} : void 0;
    if (target !== void 0) assign(task.destination, target);
    ancestors.add(current2);
    tasks.push({
      kind: "leave",
      source: current2
    });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) return void 0;
      tasks.push({
        kind: "object-property",
        source: current2,
        key,
        ...target === void 0 ? {} : { target }
      });
    }
  }
  return detach ? root : true;
}
function snapshotJsonValue(value) {
  return walkJsonValue(value, true);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{
    kind: "visit",
    node: value
  }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({
        kind: "visit",
        node: task.source[task.key]
      });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({
        kind: "property",
        source: node,
        key
      });
    }
  }
  return value;
}

// node_modules/@deepseek-ai/dsh-llm/lib/types/assistant-stream.js
function safeTime(value) {
  if (!Number.isSafeInteger(value))
    throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`);
  return value;
}
function safeIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} index must be a non-negative safe integer`);
  }
  return value;
}
function snapshotChunk(chunk) {
  const snapshot = snapshotJsonValue(chunk);
  if (snapshot === void 0)
    throw new TypeError("Assistant stream chunk must be losslessly JSON-serializable");
  return snapshot;
}
function expandAssistantStream(stream) {
  const chunks = [];
  for (const candidate of stream) {
    const record = validateRecord(candidate);
    if (record.type === "chunk") {
      chunks.push({ time: record.time, chunk: record.chunk });
      continue;
    }
    const members = record.type === "tool-call-chunks" ? record.args : record.texts;
    let time = record.time0;
    for (let index = 0; index < members.length; index += 1) {
      if (index > 0)
        time += record.dt[index - 1];
      let chunk;
      if (record.type === "text-chunks") {
        chunk = { type: "text-delta", index: record.index, text: members[index] };
      } else if (record.type === "reasoning-chunks") {
        chunk = { type: "reasoning-delta", index: record.index, text: members[index] };
      } else {
        chunk = {
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          ...Object.hasOwn(record, "name") ? { name: record.name } : {},
          argumentsDelta: members[index]
        };
      }
      chunks.push({ time, chunk });
    }
  }
  return chunks;
}
function validateRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Assistant stream record must be an object");
  }
  const record = value;
  switch (record.type) {
    case "text-chunks":
    case "reasoning-chunks": {
      exactKeys(record, ["type", "time0", "index", "dt", "texts"], record.type);
      const texts = stringArray(record.texts, `${record.type} texts`);
      if (texts.length === 0)
        throw new TypeError(`${record.type} texts must be non-empty`);
      validateRun(record, texts.length, record.type);
      return record;
    }
    case "tool-call-chunks": {
      const keys = Object.hasOwn(record, "name") ? ["type", "time0", "index", "dt", "id", "name", "args"] : ["type", "time0", "index", "dt", "id", "args"];
      exactKeys(record, keys, record.type);
      const args = stringArray(record.args, "tool-call-chunks args");
      if (args.length === 0)
        throw new TypeError("tool-call-chunks args must be non-empty");
      if (typeof record.id !== "string" || record.id.length === 0) {
        throw new TypeError("tool-call-chunks id must be a non-empty string");
      }
      if (record.name !== void 0 && (typeof record.name !== "string" || record.name.length === 0)) {
        throw new TypeError("tool-call-chunks name must be a non-empty string");
      }
      validateRun(record, args.length, record.type);
      return record;
    }
    case "chunk": {
      exactKeys(record, ["type", "time", "chunk"], "chunk");
      const time = safeTime(record.time);
      if (typeof record.chunk !== "object" || record.chunk === null || Array.isArray(record.chunk)) {
        throw new TypeError("Assistant stream raw chunk must be a lossless JSON object");
      }
      let chunk;
      try {
        chunk = snapshotChunk(record.chunk);
      } catch (error) {
        throw new TypeError("Assistant stream raw chunk must be a lossless JSON object", { cause: error });
      }
      return deepFreeze({ type: "chunk", time, chunk });
    }
    default:
      throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`);
  }
}
function validateRun(record, members, label) {
  safeTime(record.time0);
  safeIndex(record.index, label);
  if (!Array.isArray(record.dt) || record.dt.some((value) => !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} dt must contain safe integers`);
  }
  if (record.dt.length !== members - 1) {
    throw new TypeError(`${label} dt length must be one less than its members`);
  }
  let time = record.time0;
  for (const gap of record.dt) {
    time += gap;
    if (!Number.isSafeInteger(time))
      throw new TypeError(`${label} member times must stay safe integers`);
  }
}
function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((member) => typeof member !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value;
}
function exactKeys(record, keys, label) {
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))) {
    throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(", ")}`);
  }
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/assistant-stream.ts
var ClientAssistantStream = class {
  activeAttempt;
  retainedAttempt;
  pending = /* @__PURE__ */ new Map();
  publishedSeqs = /* @__PURE__ */ new Set();
  durableCursor = -1;
  transientInGap = 0;
  /**
   * Replace the durable Web window and adopt an optional reconnect baseline.
   * @param entries - durable entries in the replacement window.
   * @param baseline - compact prefix for an Assistant attempt that is still live.
   * @returns immediately visible durable entries plus reconstructed transient chunks.
   */
  replace(entries, baseline) {
    this.pending.clear();
    this.transientInGap = 0;
    this.activeAttempt = void 0;
    this.retainedAttempt = void 0;
    const opening = baseline?.activeAttempt;
    if (opening !== void 0) {
      this.activeAttempt = {
        attemptId: opening.attemptId,
        startedAfterSeq: opening.startedAfterSeq,
        turn: opening.turn,
        step: opening.step,
        nextIndex: opening.nextIndex
      };
    }
    const visible = [...entries];
    this.publishedSeqs = new Set(visible.map((entry) => entry.event.seq));
    this.durableCursor = visible.reduce((cursor, entry) => Math.max(cursor, entry.event.seq), -1);
    if (opening !== void 0) {
      for (const [index, member] of expandAssistantStream(
        opening.stream
      ).entries()) {
        this.transientInGap += 1;
        visible.push({
          type: "transient",
          event: {
            type: "assistant/live-chunk",
            seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
            time: member.time,
            data: {
              attemptId: opening.attemptId,
              turn: opening.turn,
              step: opening.step,
              chunk: member.chunk
            }
          }
        });
        if (index + 1 >= opening.nextIndex) break;
      }
    }
    return visible;
  }
  /**
   * Stage one durable v2 settlement while its matching live attempt is open.
   * @param entry - newly followed durable entry.
   * @returns a publication decision, or `undefined` when no entry becomes visible.
   */
  acceptDurable(entry) {
    const event = entry.event;
    this.durableCursor = Math.max(this.durableCursor, event.seq);
    this.transientInGap = 0;
    const settlement = assistantSettlementEntry(entry);
    if (settlement !== void 0 && this.attemptForSettlement(settlement.event) !== void 0) {
      if (this.pending.has(event.seq)) return { type: "rebaseline" };
      this.pending.set(event.seq, settlement);
      return void 0;
    }
    return this.publish(entry);
  }
  /**
   * Fold one dense transient frame and release its named durable settlement.
   * Successful messages retain their transient rows until the owning Step ends;
   * interrupted messages, failed attempts, and abandonment retire them immediately.
   * @param frame - next Assistant stream frame received by the follow connection.
   * @returns a transient, publication, or rebaseline decision, or `undefined` when no entry becomes visible.
   */
  acceptFrame(frame) {
    switch (frame.type) {
      case "start":
        if (this.activeAttempt !== void 0 || this.retainedAttempt !== void 0 || this.pending.size > 0) return { type: "rebaseline" };
        this.pending.clear();
        this.activeAttempt = {
          attemptId: frame.attemptId,
          startedAfterSeq: frame.startedAfterSeq,
          turn: frame.turn,
          step: frame.step,
          nextIndex: 0
        };
        return void 0;
      case "chunk": {
        const attempt = this.activeAttempt;
        if (attempt === void 0 || attempt.attemptId !== frame.attemptId) return void 0;
        if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
        attempt.nextIndex += 1;
        this.transientInGap += 1;
        return {
          type: "transient",
          entry: {
            type: "transient",
            event: {
              type: "assistant/live-chunk",
              seq: this.durableCursor + 1 - 1 / (this.transientInGap + 1),
              time: frame.time,
              data: {
                attemptId: frame.attemptId,
                turn: attempt.turn,
                step: attempt.step,
                chunk: frame.chunk
              }
            }
          }
        };
      }
      case "end": {
        const attempt = this.activeAttempt;
        if (attempt === void 0 || attempt.attemptId !== frame.attemptId) {
          return void 0;
        }
        this.activeAttempt = void 0;
        if (frame.index !== attempt.nextIndex) return { type: "rebaseline" };
        if (frame.outcome.kind === "abandoned") {
          return this.pending.size === 0 ? { type: "abandonment", attemptId: attempt.attemptId } : { type: "rebaseline" };
        }
        if (this.publishedSeqs.has(frame.outcome.seq)) return void 0;
        const entry = this.pending.get(frame.outcome.seq);
        if (entry === void 0 || entry.event.type !== frame.outcome.eventType) {
          return { type: "rebaseline" };
        }
        this.pending.delete(frame.outcome.seq);
        if (entry.event.type === "assistant/message" && entry.event.data.interrupted !== true) {
          this.retainedAttempt = { attemptId: attempt.attemptId, turn: attempt.turn, step: attempt.step };
          return this.publish(entry);
        }
        this.publishedSeqs.add(entry.event.seq);
        return { type: "settlement", attemptId: attempt.attemptId, entry };
      }
    }
  }
  attemptForSettlement(event) {
    const attempt = this.activeAttempt;
    if (attempt === void 0 || event.type === "assistant/message" && event.surfaceOp !== "append" || event.seq <= attempt.startedAfterSeq || attempt.turn !== event.data.turn || attempt.step !== event.data.step) return void 0;
    return attempt;
  }
  publish(entry) {
    this.publishedSeqs.add(entry.event.seq);
    const retained = this.retainedAttempt;
    if (retained !== void 0 && entry.event.type === "step/end" && entry.event.data.turn === retained.turn && entry.event.data.step === retained.step) {
      this.retainedAttempt = void 0;
      return { type: "publish", entry, retireAttemptId: retained.attemptId };
    }
    return { type: "publish", entry };
  }
};
function assistantSettlementEntry(entry) {
  return entry.event.type === "assistant/message" || entry.event.type === "assistant/attempt" ? entry : void 0;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/session.ts
function projectionsBaseline(value) {
  return {
    ...value,
    asOfSeq: value.asOfSeq === -1 ? -1 : SessionSeq(value.asOfSeq)
  };
}
var PAGE_MESSAGES = 50;
var HISTORY_PAGE_OPTIONS = { maxMessages: 500, turnWindow: { minMessages: PAGE_MESSAGES, minTurns: 2 } };
var JUMP_PAGE_MESSAGES = 200;
var JUMP_PAGE_OPTIONS = {
  ...HISTORY_PAGE_OPTIONS,
  turnWindow: { ...HISTORY_PAGE_OPTIONS.turnWindow, minMessages: JUMP_PAGE_MESSAGES }
};
var Session = class {
  /**
   * @param sessionId - Host session identity (client sessions are always Host-born).
   * @param remote - generated Remote namespaces this session calls.
   * @param options - optional manager-owned state observers.
   */
  constructor(sessionId, remote, options = {}) {
    this.sessionId = sessionId;
    this.remote = remote;
    this.options = options;
    this.projections = options.projections ?? new ProjectionValueStore();
    this.address = options.address;
    this.parentAvailable = options.parentAvailable;
    this.notifier = new Notifier(() => {
      this.snapshotCache = this.buildSnapshot();
    });
    this.snapshotCache = this.buildSnapshot();
    this.stopObservingInbox = this.projections.faceOf("inbox").subscribe(() => {
      this.observeSubmissionInbox();
    });
  }
  // ---- Window and derived state (all private; the snapshot is the only read API) ----
  baseSeq = SessionLogOffset(0);
  hasMore = false;
  openState = "cold";
  openError = null;
  openPromise = null;
  /** Bumped by stream replacement to invalidate an in-flight doOpen. Stale
   *  passes drop all writes once the generation moves on. */
  openGeneration = 0;
  loadingOlder = false;
  /** Shared low-water target of the running jump loop; null when no jump is paging. */
  jumpTargetSeq = null;
  /** The running jump loop's completion, shared by retargeting callers. */
  jumpPromise = null;
  pendingHistory = null;
  stopObservingInbox;
  assistantStream = new ClientAssistantStream();
  running = false;
  address;
  parentAvailable;
  /**
   * Sticky send marker, private input of the composerPhase derivation: set
   * synchronously before prompt()'s first await, never reset — the blank →
   * engaging edge of the phase machine (see ComposerPhase).
   */
  promptAttempted = false;
  /** A first accepted prompt stays in the engaging phase until its turn is observable. */
  firstPromptPendingTurn = false;
  /** New Session display state; unknown bare sessions begin conservatively blank. */
  blankBit = true;
  removed = false;
  promptError = null;
  lastAgentError = null;
  /** Local submission echoes, insertion-ordered (see SessionSnapshot.pendingSubmissions). */
  pendingSubmissions = [];
  /** Per-echo settlement state; `retiring` latches the first observation so a
   *  Inbox projection and its durable event cannot both retire one echo. */
  submissionSettlements = /* @__PURE__ */ new Map();
  /** Owns the addressed page/follow lifecycle while this Session is open. */
  events;
  /**
   * Per-session projection value store (push model; see the session-projection
   * subsystem page, docs/subsystems/session-projection.md): finished whole
   * values computed on the Host, seeded by the tail page's
   * projections block and updated by Session Controller control frames;
   * Host-sequenced writes merge under higher-seq-wins and cached list blocks
   * yield to them (projection-store.ts). Keys are read via `projections.faceOf(key)`
   * (the useProjection resolution face); the conversation snapshot never
   * carries projection values, and no client-side domain folding exists.
   * Manager-owned when constructed through SessionManager (frames route and
   * the store outlives instantiation, the title-snapshot precedent); a bare
   * construction gets a private store.
   */
  projections;
  /** Contiguous history and live tail consumed by Conversation assembly. */
  eventSource = new MutableSessionEventSource();
  snapshotCache;
  notifier;
  /**
   * Agent-scoped cordis context, bound once by ClientSessions when it
   * mints the scope (the client mirror of the host Agent's loopCtx). The
   * Session dispatches its own scoped events through it; undefined means
   * unbound (bare object-layer construction) or already pruned — both skip
   * dispatch-dependent behavior rather than fail.
   */
  actx;
  /**
   * Bind the Agent-scoped context minted by ClientSessions (single write;
   * a second bind is a wiring error and throws). Direction stays one-way at
   * this binding boundary: consumers still reach the Session via `sessions.sessionOf`,
   * while the Session holds its own dispatch point (host Agent.loopCtx
   * mirror).
   * @param actx - the agent's scoped context.
   */
  bindScope(actx) {
    if (this.actx !== void 0) throw new Error(`session ${this.sessionId} already has a bound scope`);
    this.actx = actx;
  }
  /** Release the bound scope at prune time (a later rebind accompanies a freshly minted scope). */
  unbindScope() {
    this.actx = void 0;
  }
  // ---- Operations ----
  /**
   * Register one local submission echo (see the ISession declaration).
   * Synchronous through markDirty: the echo is in the very next snapshot, so
   * the conversation can paint it before the caller starts serializing.
   * @param input - echo content and the optional settlement callback.
   * @returns the minted identity for {@link prompt} plus the pre-prompt abandon path.
   */
  beginSubmission(input) {
    const requestId = randomUUID();
    const placement = this.running ? input.mode === "steer" ? "steering" : "queued" : "transcript";
    this.pendingSubmissions = [...this.pendingSubmissions, {
      requestId,
      placement,
      time: Date.now(),
      text: input.text,
      attachments: input.attachments
    }];
    this.submissionSettlements.set(requestId, { placement, onRetire: input.onRetire, retiring: false });
    this.promptAttempted = true;
    this.notifier.markDirty();
    return { requestId, abandon: () => {
      this.retireFailedSubmission(requestId);
    } };
  }
  /**
   * Send (queue/steer passed through 1:1); failures land in the snapshot's promptError.
   * @param content - text, browser-owned temporary image uploads, and staged-file receipts.
   * @param mode - queue appends after the current turn; steer interrupts it.
   * @param signal - optional caller cancellation for the complete admission round-trip.
   * @param requestId - identity from {@link beginSubmission}; a failed identified prompt retires its echo.
   * @returns the prompt result (also mirrored into promptError on failure).
   */
  async prompt(content, mode, signal, requestId) {
    this.promptError = null;
    this.lastAgentError = null;
    this.promptAttempted = true;
    if (this.blankBit) this.firstPromptPendingTurn = true;
    this.notifier.markDirty();
    let result;
    if (this.address === void 0) {
      const clientTimeZone = resolvedClientTimeZone();
      result = await this.remote.session.prompt({
        requestId: requestId ?? randomUUID(),
        sessionId: this.sessionId,
        mode,
        content,
        clientTimeZone
      }, signal);
    } else if (content.some((part) => part.type === "file")) {
      result = {
        ok: false,
        error: new RemoteError(
          "subagent/attachment-invalid",
          "subagent continuation does not accept files",
          { reason: "SUBAGENT_FILE_UNSUPPORTED" }
        )
      };
    } else {
      const routedContent = content;
      const routed = await this.remote.subagents.prompt({
        requestId: randomUUID(),
        parentSessionId: this.address.parentSessionId,
        childSessionId: this.address.childSessionId,
        mode: "continuable",
        delivery: mode,
        content: routedContent,
        clientTimeZone: resolvedClientTimeZone()
      }, signal);
      result = routed.ok ? { ok: true, value: { accepted: true } } : routed;
    }
    if (!result.ok) {
      if (requestId !== void 0) this.retireFailedSubmission(requestId);
      this.promptError = { op: "send", error: result.error };
      this.notifier.markDirty();
      return result;
    }
    if (this.blankBit) {
      this.blankBit = false;
      this.notifier.markDirty();
    }
    this.options.onEngaged?.(this);
    return result;
  }
  /**
   * Resolve one image referenced by this session into browser-consumable bytes.
   * @param attachmentId - opaque id found in the folded session log.
   * @returns the authenticated reference and decoded bytes.
   */
  async readAttachment(attachmentId) {
    const result = await this.remote.session.attachment({
      sessionId: this.sessionId,
      attachmentId
    });
    if (!result.ok) return result;
    const binary = atob(result.value.data);
    const data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return { ok: true, value: { attachment: result.value.attachment, data } };
  }
  /** Apply one operation to a still-pending queue occurrence. */
  async updateQueue(itemId, action) {
    return this.remote.session.updateQueue({ sessionId: this.sessionId, itemId, action });
  }
  /**
   * Stop the active turn while the Host preserves pending inbox work; failures
   * land in promptError (same error-strip display slot). A subagent address
   * routes through `subagents.interruptByParent`, whose durable parent-address
   * authority works without a live parent Agent.
   * @returns the cancel result.
   */
  async cancel() {
    const address = this.address;
    const result = address !== void 0 ? await this.remote.subagents.interruptByParent(
      address.childSessionId,
      address.parentSessionId,
      "continuable"
    ) : await this.remote.session.cancel({ sessionId: this.sessionId });
    if (!result.ok) {
      this.promptError = { op: "stop", error: result.error };
      this.notifier.markDirty();
    }
    return result;
  }
  /**
   * Rename: contract session.rename 1:1. On success settle the 'title'
   * projection cell from the response's `{title, seq}` under the store's
   * higher-seq-wins rule (the push frame arriving later is a no-op replay),
   * so the list row and any useProjection('title') reader update without
   * waiting for the control-stream projection update.
   * @param title - raw title text (the host normalizes acceptance).
   * @returns the rename result (normalized accepted title + title event seq).
   */
  async rename(title) {
    const result = await this.remote.session.rename({ sessionId: this.sessionId, title });
    if (!result.ok) return result;
    const seq = SessionSeq(result.value.seq);
    this.projections.apply("title", result.value.title, seq);
    return { ok: true, value: { title: result.value.title, seq } };
  }
  /**
   * Execute one slash-command line against this session's agent — pure
   * admission semantics (the host executor durably logs the lifecycle;
   * outcomes render as flow nodes, never as a response echo).
   * @param line - the full command line, leading slash included.
   * @returns the admission result.
   */
  async command(line) {
    const result = await this.remote.commands.execute(this.sessionId, line, []);
    if (!result.ok) return result;
    return { ok: true, value: { matched: result.value !== void 0 } };
  }
  /** First open: pull the tail page (idempotent — in-flight/already-open returns the existing promise). */
  open() {
    if (this.openState === "open") return Promise.resolve();
    if (this.openPromise !== null) return this.openPromise;
    const promise = this.doOpen(this.openGeneration).finally(() => {
      if (this.openPromise === promise) this.openPromise = null;
    });
    this.openPromise = promise;
    return promise;
  }
  /** Prepend one Turn-aligned page: at least 50 messages and two Turn starts, capped at 500 messages. */
  async loadOlder() {
    if (this.openState !== "open" || !this.hasMore || this.loadingOlder) return;
    const events = this.events;
    if (events === void 0) return;
    this.loadingOlder = true;
    this.notifier.markDirty();
    try {
      await events.prepend({
        beforeSeq: this.baseSeq,
        ...HISTORY_PAGE_OPTIONS
      });
    } catch (error) {
      if (!isRemoteFailure(error)) {
        console.error("[session-controller] loadOlder failed:", error);
      }
    } finally {
      this.loadingOlder = false;
      this.notifier.markDirty();
    }
  }
  /** Jump loader: page backwards until the window covers seq (see ISession.loadThrough). */
  loadThrough(seq) {
    if (this.openState !== "open" || !this.hasMore || this.baseSeq <= seq) return Promise.resolve();
    if (this.jumpPromise !== null) {
      this.jumpTargetSeq = SessionSeq(Math.min(this.jumpTargetSeq ?? seq, seq));
      return this.jumpPromise;
    }
    if (this.loadingOlder) return Promise.resolve();
    const events = this.events;
    if (events === void 0) return Promise.resolve();
    const pending = {
      beforeSeq: this.baseSeq,
      hasMore: this.hasMore,
      pages: []
    };
    this.pendingHistory = pending;
    this.jumpTargetSeq = seq;
    this.loadingOlder = true;
    this.notifier.markDirty();
    const generation = this.openGeneration;
    this.jumpPromise = (async () => {
      try {
        while (pending.hasMore && this.jumpTargetSeq !== null && pending.beforeSeq > this.jumpTargetSeq) {
          if (generation !== this.openGeneration) return;
          const before = pending.beforeSeq;
          await events.prepend({ beforeSeq: before, ...JUMP_PAGE_OPTIONS });
          if (pending.beforeSeq >= before) return;
        }
      } catch (error) {
        if (!isRemoteFailure(error)) {
          console.error("[session-controller] loadThrough failed:", error);
        }
      } finally {
        this.jumpTargetSeq = null;
        this.jumpPromise = null;
        this.pendingHistory = null;
        this.loadingOlder = false;
        if (generation === this.openGeneration && pending.pages.length > 0) {
          this.prependWindow(pending.pages.reverse().flat(), pending.hasMore);
        }
        this.notifier.markDirty();
      }
    })();
    return this.jumpPromise;
  }
  /** Rebuild an opened history source after address replacement.
   *  Invalidates any in-flight open first; projection state belongs to the independently
   *  reconnecting control stream and remains untouched. */
  async resync() {
    if (this.openState === "cold") return;
    this.openGeneration++;
    const events = this.events;
    this.events = void 0;
    await events?.dispose();
    this.openPromise = null;
    this.openState = "cold";
    this.openError = null;
    this.baseSeq = SessionLogOffset(0);
    this.notifier.markDirty();
    await this.open();
  }
  // ---- Subscription API (useSyncExternalStore direct wiring) ----
  /**
   * uSES subscription entry.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribe(listener) {
    return this.notifier.subscribe(listener);
  }
  /**
   * Cached Session snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   */
  getSnapshot() {
    this.notifier.ensureFresh();
    return this.snapshotCache;
  }
  // ---- Manager-only entry points (@internal; never called by the UI) ----
  /**
   * Running-bit relay from the host stream (list entry and snapshot stay consistent).
   * @param running - the new running state.
   */
  handleRunning(running) {
    if (running && this.blankBit) {
      this.blankBit = false;
      this.notifier.markDirty();
    }
    if (running) this.firstPromptPendingTurn = false;
    if (this.running === running) return;
    this.running = running;
    this.notifier.markDirty();
  }
  /**
   * Install or clear the catalog-discovered transport address. A changed
   * address rebuilds an already-open window through its new history route.
   * @param address - direct parent/child address, or undefined for ordinary transport.
   * @param parentAvailable - latest exact-parent availability hint, or undefined before a catalog read.
   */
  configureSubagent(address, parentAvailable) {
    const same = this.address?.parentSessionId === address?.parentSessionId && this.address?.childSessionId === address?.childSessionId && this.address?.mode === address?.mode;
    this.address = address;
    this.parentAvailable = parentAvailable;
    if (!same && this.openState !== "cold") void this.resync();
    else this.notifier.markDirty();
  }
  /**
   * Update only the parent availability hint from a catalog refresh.
   * @param available - whether the exact direct parent is live.
   */
  handleSubagentParentAvailable(available) {
    if (this.parentAvailable === available) return;
    this.parentAvailable = available;
    this.notifier.markDirty();
  }
  /**
   * Apply the Manager's effective display blank, further reconciled with the
   * current `sessionListMetadata` projection. Local send attempts and current
   * running state prevent re-blanking; an earlier false summary alone does not.
   * The Manager retains acceptance and earlier running observations across
   * Session-object replacement.
   * @param blank - New Session display state after Manager reconciliation.
   */
  handleBlank(blank) {
    blank = blank && this.projections.values().sessionListMetadata?.blank !== false;
    if (blank === this.blankBit) return;
    if (blank && (this.promptAttempted || this.running)) return;
    this.blankBit = blank;
    this.notifier.markDirty();
  }
  /** `api-session/removed` relay: flag the snapshot while retaining the resident instance. */
  handleRemoved() {
    this.removed = true;
    this.notifier.markDirty();
  }
  /**
   * `api-session/error` relay: the outlet for live failures with no turn position.
   * @param message - the stringified error.
   */
  handleAgentError(message) {
    this.lastAgentError = message;
    this.notifier.markDirty();
  }
  /**
   * Stop the Session's live Remote source.
   * @returns when the Remote iterator has completed teardown.
   */
  async dispose() {
    this.stopObservingInbox();
    for (const [requestId, settlement] of [...this.submissionSettlements]) {
      if (settlement.admitted !== void 0) this.scheduleObservedRetirement(requestId, settlement.admitted);
      else this.retireFailedSubmission(requestId);
    }
    this.openGeneration++;
    const events = this.events;
    this.events = void 0;
    await events?.dispose();
  }
  // ---- Private ----
  /** @param generation - openGeneration at launch; stale passes cannot publish after replacement. */
  async doOpen(generation) {
    this.openState = "loading";
    this.openError = null;
    this.notifier.markDirty();
    const events = new SessionEventStream(this.remote, this.sessionAddress(), {
      publish: (change) => {
        if (generation !== this.openGeneration || this.events !== events) return;
        this.acceptEventChange(change);
      },
      failed: (error) => {
        this.failEventStream(events, generation, error);
      }
    });
    this.events = events;
    try {
      await events.open(HISTORY_PAGE_OPTIONS);
      if (generation !== this.openGeneration || this.events !== events) return;
      this.openState = "open";
    } catch (error) {
      if (generation !== this.openGeneration || this.events !== events) return;
      if (!isRemoteFailure(error)) throw error;
      this.events = void 0;
      this.openState = "error";
      this.openError = error;
    } finally {
      if (generation === this.openGeneration) this.notifier.markDirty();
    }
  }
  /** Apply one contiguous journal update already reconciled by the Remote stream. */
  acceptEventChange(change) {
    switch (change.type) {
      case "replace":
        this.installWindow(
          change.entries,
          change.hasMore,
          change.page.projections === void 0 ? void 0 : projectionsBaseline(change.page.projections),
          change.page.assistantStream
        );
        return;
      case "prepend":
        this.prependWindow(change.entries, change.hasMore);
        return;
      case "append":
        this.publishAssistantEntry(this.assistantStream.acceptDurable(change.entry));
        return;
      case "assistant-stream":
        this.publishAssistantEntry(this.assistantStream.acceptFrame(change.frame));
    }
  }
  /** Replace the complete contiguous window and apply page-owned projection metadata. */
  installWindow(entries, hasMore, projections, assistantStream) {
    const visible = this.assistantStream.replace(entries, assistantStream);
    this.baseSeq = SessionLogOffset(entries[0]?.event.seq ?? 0);
    this.hasMore = hasMore;
    if (this.pendingHistory !== null) {
      this.pendingHistory.beforeSeq = this.baseSeq;
      this.pendingHistory.hasMore = hasMore;
      this.pendingHistory.pages.length = 0;
    }
    if (visible.some((entry) => entry.event.type === "turn/start")) this.firstPromptPendingTurn = false;
    if (projections !== void 0) this.projections.seed(projections);
    this.eventSource.replace(visible, hasMore);
    if (projections !== void 0) {
      for (const [requestId, { receipt }] of this.submissionSettlements) {
        if (receipt !== void 0 && receipt.seq <= projections.asOfSeq) {
          this.scheduleObservedRetirement(requestId, receipt.attachments);
        }
      }
    }
    for (const entry of visible) this.observeSubmissionEvent(entry.event);
    if (projections !== void 0) {
      const inbox = projections.values.inbox;
      for (const target of ["next-turn", "next-step"]) {
        this.observeSubmissionInsertions(target, inbox?.[target] ?? [], 0, projections.asOfSeq);
      }
    }
    this.notifier.markDirty();
  }
  publishAssistantEntry(result) {
    if (result?.type === "rebaseline") {
      const events = this.events;
      queueMicrotask(() => {
        if (events !== void 0 && this.events === events) events.restart();
      });
      return;
    }
    if (result?.type === "settlement") {
      this.eventSource.settleAssistant(result.attemptId, result.entry);
      this.observeSubmissionEvent(result.entry.event);
      this.notifier.markDirty();
      return;
    }
    if (result?.type === "abandonment") {
      this.eventSource.settleAssistant(result.attemptId);
      this.notifier.markDirty();
      return;
    }
    if (result?.type === "publish") {
      const changed = this.appendLive(result.entry);
      if (result.retireAttemptId !== void 0) this.eventSource.settleAssistant(result.retireAttemptId);
      if (changed || result.retireAttemptId !== void 0) this.notifier.markDirty();
    } else if (result?.type === "transient") {
      this.eventSource.append(result.entry);
      this.notifier.markDirty();
    }
  }
  /** Prepend one stream-validated history page. */
  prependWindow(entries, hasMore) {
    if (this.pendingHistory !== null) {
      const pending = this.pendingHistory;
      pending.beforeSeq = entries[0] === void 0 ? pending.beforeSeq : SessionLogOffset(entries[0].event.seq);
      pending.hasMore = hasMore;
      pending.pages.push(entries);
      return;
    }
    this.baseSeq = entries[0] === void 0 ? this.baseSeq : SessionLogOffset(entries[0].event.seq);
    this.hasMore = hasMore;
    this.eventSource.prepend(entries, hasMore);
  }
  /** Append one stream-validated live event. */
  appendLive(entry) {
    const event = entry.event;
    const awaitingFirstTurn = this.firstPromptPendingTurn;
    if (event.type === "turn/start") this.firstPromptPendingTurn = false;
    this.eventSource.append(entry);
    this.observeSubmissionEvent(event);
    return awaitingFirstTurn !== this.firstPromptPendingTurn;
  }
  /** Observe durable acceptance even when insertion and claim share one projection notification. */
  observeSubmissionEvent(event) {
    if (this.submissionSettlements.size === 0) return;
    if (event.type === "agent/inbox/spliced") {
      const { target, start, removedCount = 0, inserted, outcome } = event.data;
      for (const [requestId, settlement] of this.submissionSettlements) {
        const receipt = settlement.receipt;
        if (receipt?.target !== target || receipt.index === null || receipt.seq >= event.seq) continue;
        const removed = receipt.index >= start && receipt.index < start + removedCount;
        if (removed && outcome === "canceled") this.retireFailedSubmission(requestId);
        else settlement.receipt = {
          ...receipt,
          seq: event.seq,
          index: removed ? null : receipt.index < start ? receipt.index : receipt.index + inserted.length - removedCount
        };
      }
      this.observeSubmissionInsertions(target, inserted, start, event.seq);
      for (const message of inserted) this.observeSubmissionMessage(message, false);
      return;
    }
    if (event.type === "request/context" || event.type === "turn/end") {
      for (const [requestId, settlement] of this.submissionSettlements) {
        if (settlement.admitted === void 0 && settlement.receipt?.index === null && settlement.receipt.seq < event.seq) this.retireFailedSubmission(requestId);
      }
      return;
    }
    if (event.type === "user/message") this.observeSubmissionMessage(event.data, true);
  }
  observeSubmissionInsertions(target, messages, start, seq) {
    for (const [index, message] of messages.entries()) {
      const source = message.source;
      if (source.kind !== "user" || !("rpcId" in source)) continue;
      const settlement = this.submissionSettlements.get(source.rpcId);
      if (settlement === void 0 || settlement.placement === "queued" || settlement.retiring || (settlement.receipt?.seq ?? -1) > seq) continue;
      settlement.receipt = { target, seq, index: start + index, attachments: attachmentRefsIn(message.content) };
    }
  }
  observeSubmissionMessage(message, admitted) {
    const source = message.source;
    if (source.kind !== "user" || !("rpcId" in source)) return;
    const settlement = this.submissionSettlements.get(source.rpcId);
    if (settlement === void 0 || settlement.retiring) return;
    if (!admitted) {
      if (settlement.placement === "queued") this.scheduleObservedRetirement(source.rpcId, attachmentRefsIn(message.content));
      return;
    }
    settlement.admitted = attachmentRefsIn(message.content);
    this.retireAdmittedSubmission(source.rpcId);
  }
  /** Retire admitted Chat identities only after stale Inbox rows can no longer reappear. */
  retireAdmittedSubmission(requestId) {
    const settlement = this.submissionSettlements.get(requestId);
    if (settlement?.admitted === void 0) return;
    const receipt = settlement.receipt;
    if (receipt?.index === null && (this.projections.seqOf("inbox") ?? -1) < receipt.seq) return;
    this.scheduleObservedRetirement(requestId, settlement.admitted);
  }
  /** Inbox acceptance retires queued echoes; its watermark completes admitted Chat handoffs. */
  observeSubmissionInbox() {
    if (this.submissionSettlements.size === 0) return;
    const inbox = this.projections.get("inbox");
    if (inbox === void 0) return;
    const seq = this.projections.seqOf("inbox");
    for (const target of ["next-turn", "next-step"]) {
      if (seq !== void 0) this.observeSubmissionInsertions(target, inbox[target], 0, seq);
      for (const message of inbox[target]) this.observeSubmissionMessage(message, false);
    }
    for (const requestId of this.submissionSettlements.keys()) this.retireAdmittedSubmission(requestId);
  }
  /**
   * Latch one observed settlement and remove the echo an animation frame
   * later. The delay keeps the echo in the snapshot until the frame in which
   * the durable node (whose assembly frame was registered first) is
   * renderable; the render-time rpcId dedupe hides the one-frame overlap.
   */
  scheduleObservedRetirement(requestId, attachments) {
    const settlement = this.submissionSettlements.get(requestId);
    if (settlement === void 0 || settlement.retiring) return;
    settlement.retiring = true;
    scheduleFrame(() => {
      this.finishSubmission(requestId, { reason: "observed", attachments });
    });
  }
  /** Remove one unsettled echo immediately (prompt rejection, abort, or disposal). */
  retireFailedSubmission(requestId) {
    const settlement = this.submissionSettlements.get(requestId);
    if (settlement === void 0 || settlement.retiring || settlement.admitted !== void 0) return;
    settlement.retiring = true;
    this.finishSubmission(requestId, { reason: "failed" });
  }
  /** Single removal point: drop the echo, publish, then notify the owner. */
  finishSubmission(requestId, retirement) {
    const settlement = this.submissionSettlements.get(requestId);
    if (settlement === void 0) return;
    this.submissionSettlements.delete(requestId);
    this.pendingSubmissions = this.pendingSubmissions.filter((echo) => echo.requestId !== requestId);
    this.notifier.markDirty();
    settlement.onRetire?.(retirement);
  }
  /** Publish a terminal background failure only while this stream still owns the Session. */
  failEventStream(events, generation, error) {
    if (generation !== this.openGeneration || this.events !== events) return;
    if (!isRemoteFailure(error)) throw error;
    this.openGeneration++;
    this.events = void 0;
    this.openPromise = null;
    this.openState = "error";
    this.openError = error;
    void events.dispose();
    this.notifier.markDirty();
  }
  buildSnapshot() {
    const identity = this.projections.values().subagent;
    return {
      sessionId: this.sessionId,
      pendingSubmissions: this.pendingSubmissions,
      running: this.running,
      subagent: this.address === void 0 ? null : {
        address: this.address.mode === "unknown" && identity != null ? { ...this.address, mode: identity.mode } : this.address,
        ...this.parentAvailable === void 0 ? {} : { parentAvailable: this.parentAvailable }
      },
      removed: this.removed,
      openState: this.openState,
      openError: this.openError,
      hasMore: this.hasMore,
      loadingOlder: this.loadingOlder,
      promptError: this.promptError,
      blank: this.blankBit,
      lastAgentError: this.lastAgentError,
      promptAttempted: this.promptAttempted,
      awaitingFirstTurn: this.firstPromptPendingTurn
    };
  }
  sessionAddress() {
    return this.address === void 0 ? { kind: "session", sessionId: this.sessionId } : { kind: "subagent", ...this.address };
  }
};
function scheduleFrame(fn) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
    fn();
  });
  else setTimeout(fn, 0);
}
function attachmentRefsIn(content) {
  if (!Array.isArray(content)) return [];
  const refs = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const candidate = block;
    if ((candidate.type === "image" || candidate.type === "file") && typeof candidate.attachment === "object" && candidate.attachment !== null) {
      refs.push(candidate.attachment);
    }
  }
  return refs;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/ordered-baseline.ts
function mergeOrderedBaseline(current2, baseline, keyOf) {
  const baselineByKey = /* @__PURE__ */ new Map();
  for (const value of baseline) baselineByKey.set(keyOf(value), value);
  const merged = current2.map((value) => baselineByKey.get(keyOf(value))).filter((value) => value !== void 0);
  const mergedKeys = new Set(merged.map(keyOf));
  for (let index = 0; index < baseline.length; index++) {
    const value = baseline[index];
    if (value === void 0 || mergedKeys.has(keyOf(value))) continue;
    let insertion = merged.length;
    for (let following = index + 1; following < baseline.length; following++) {
      const candidate = baseline[following];
      if (candidate === void 0) continue;
      const known = merged.findIndex((item) => keyOf(item) === keyOf(candidate));
      if (known !== -1) {
        insertion = known;
        break;
      }
    }
    merged.splice(insertion, 0, value);
    mergedKeys.add(keyOf(value));
  }
  return merged;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/lineage.ts
function flattenLineage(summaries) {
  const byId = /* @__PURE__ */ new Map();
  for (const s of summaries) byId.set(s.sessionId, s);
  const children = /* @__PURE__ */ new Map();
  const roots = [];
  for (const s of summaries) {
    if (s.parentSessionId !== void 0 && byId.has(s.parentSessionId)) {
      const list = children.get(s.parentSessionId) ?? [];
      list.push(s);
      children.set(s.parentSessionId, list);
    } else {
      roots.push(s);
    }
  }
  const out = [];
  const visited = /* @__PURE__ */ new Set();
  const walk = (s, depth) => {
    if (visited.has(s.sessionId)) {
      console.warn(`[session-controller] lineage cycle at ${s.sessionId}; emitting as root`);
      return;
    }
    visited.add(s.sessionId);
    const { agentAvailable: _agentAvailable, ...row } = s;
    out.push({
      ...row,
      depth
    });
    const kids = children.get(s.sessionId);
    if (kids === void 0) return;
    for (const kid of kids) walk(kid, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const s of summaries) {
    if (!visited.has(s.sessionId)) walk(s, 0);
  }
  return out;
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/manager.ts
function sessionSeqCursor(value) {
  return value === -1 ? -1 : SessionSeq(value);
}
var SessionManager = class {
  /** @param remote - generated Remote namespaces used by catalog and history readers. */
  constructor(remote) {
    this.remote = remote;
    this.listSnapshotCache = this.buildListSnapshot();
  }
  sessions = /* @__PURE__ */ new Map();
  /** In-flight Session disposals remain here after instances leave `sessions`, so manager disposal can await quiescence. */
  sessionDisposals = /* @__PURE__ */ new Set();
  /**
   * Accepted/running presentation must survive a later empty-history list
   * response. Host-asserted running is recorded even before a row, instance, or
   * address holds the identity — the listing that would hold it may not have
   * landed yet — while the client-local acceptance callback requires a current
   * holder, because it can arrive from a replaced or already-dropped Session.
   */
  engagedSessions = /* @__PURE__ */ new Set();
  disposed = false;
  /** Per-session projection value stores, retained independently of instance arrival (the
   *  title-snapshot precedent, generalized): push frames land here whether or not the Session
   *  is instantiated (list rows read the 'title' key), and an instantiated Session adopts the
   *  same store so history-baseline seeding and frames converge on one row set. */
  projectionStores = /* @__PURE__ */ new Map();
  summaries = [];
  listState = "idle";
  /** Arrival phase; the pending → ready edge fires on the first successful pull (see SessionListPhase). */
  listPhase = "pending";
  listError = null;
  listInflight = null;
  /** Active list request's mutation log; its identity also fences completion after reconnect. */
  listMutations = null;
  addresses = /* @__PURE__ */ new Map();
  projectionLoads = /* @__PURE__ */ new Map();
  projectionInflight = /* @__PURE__ */ new Map();
  listSnapshotCache;
  /** Entry-identity cache (reference stability): list rebuilds reuse the previous entry
   *  object when every field matches — wire refreshes mint all-new summary objects, so identity
   *  must be recovered by value or every SessionListItem memo misses on every refresh. */
  entryCache = /* @__PURE__ */ new Map();
  itemsCache = [];
  notifier = new Notifier(() => {
    this.listSnapshotCache = this.buildListSnapshot();
  });
  /**
   * Resolve an acquisition target without materializing a Session.
   * @param target - known identity or durable direct-parent address.
   * @returns the resolved identity with its explicit or catalog-derived history route installed.
   */
  resolveTarget(target) {
    const id = typeof target === "string" ? target : target.childSessionId;
    const address = typeof target === "string" ? this.subagentAddress(id) : target;
    if (typeof target === "string" && !this.sessions.has(id) && !this.summaries.some((summary) => summary.sessionId === id) && address === void 0) {
      throw new Error(`sessions.retain: unknown session ${id}`);
    }
    if (address !== void 0) this.addresses.set(id, address);
    this.sessions.get(id)?.configureSubagent(
      address,
      address === void 0 ? void 0 : this.agentAvailable(address.parentSessionId)
    );
    return id;
  }
  /**
   * Resolve an address for breadcrumb navigation without retaining transport authority.
   * @param sessionId - possible child id in an already-loaded catalog.
   * @returns A retained or catalog-derived direct-parent address.
   */
  subagentAddress(sessionId) {
    const retained = this.addresses.get(sessionId);
    if (retained !== void 0) return retained;
    for (const parentSessionId of this.projectionStores.keys()) {
      const child = this.projectionStores.get(parentSessionId)?.values().subagentCatalog?.find((entry) => entry.id === sessionId);
      if (child !== void 0) {
        return {
          parentSessionId,
          childSessionId: sessionId,
          mode: child.mode
        };
      }
    }
    return void 0;
  }
  // ---- Instance management ----
  /**
   * Withdraw an exact Client instance before running its teardown callbacks.
   * @param sessionId - identity to withdraw.
   * @param expected - instance being released; a replacement is left untouched.
   * @returns completion of the detached instance's stream teardown.
   */
  drop(sessionId, expected) {
    const session = this.sessions.get(sessionId);
    if (session !== expected) return Promise.resolve();
    this.sessions.delete(sessionId);
    this.addresses.delete(sessionId);
    this.pruneEngagement(sessionId, this.retainedIds(this.summaries));
    return this.startSessionDisposal(session);
  }
  /**
   * Stop catalog requests and dispose every resident Session.
   * @returns once catalog requests and every Session stream have stopped.
   */
  async dispose() {
    this.disposed = true;
    this.listMutations = null;
    this.listInflight = null;
    this.engagedSessions.clear();
    const reads = [...this.projectionInflight.values()];
    for (const { controller } of reads) controller.abort();
    this.projectionInflight.clear();
    await Promise.all(reads.map((read) => read.promise));
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.addresses.clear();
    for (const session of sessions) void this.startSessionDisposal(session);
    await this.drainSessionDisposals();
  }
  startSessionDisposal(session) {
    const disposal = session.dispose();
    this.sessionDisposals.add(disposal);
    void disposal.then(
      () => {
        this.sessionDisposals.delete(disposal);
      },
      () => {
        this.sessionDisposals.delete(disposal);
      }
    );
    return disposal;
  }
  async drainSessionDisposals() {
    while (this.sessionDisposals.size > 0) {
      await Promise.allSettled([...this.sessionDisposals]);
    }
  }
  /**
   * Lazy build: return the existing instance or construct one (no auto-open —
   * the reference allocator opens history after binding the scope).
   * New instances reconcile retained metadata before returning.
   * @param sessionId - the session to get.
   * @returns the resident instance.
   */
  get(sessionId) {
    let session = this.sessions.get(sessionId);
    if (session === void 0) {
      session = this.createSession(sessionId);
      this.sessions.set(sessionId, session);
      const summary = this.summaries.find((s) => s.sessionId === sessionId);
      if (summary !== void 0) {
        session.handleBlank(this.effectiveBlank(summary));
        session.handleRunning(summary.running);
      } else {
        const address = this.addresses.get(sessionId);
        const child = address === void 0 ? void 0 : this.projectionStores.get(address.parentSessionId)?.values().subagentCatalog?.find((entry) => entry.id === sessionId);
        if (child !== void 0) {
          session.handleBlank(false);
          session.handleRunning(false);
        } else {
          session.handleBlank(true);
        }
      }
    }
    return session;
  }
  createSession(sessionId) {
    const address = this.addresses.get(sessionId);
    const parentAvailable = address === void 0 ? void 0 : this.agentAvailable(address.parentSessionId);
    return new Session(sessionId, this.remote, {
      ...address === void 0 ? {} : {
        address,
        ...parentAvailable === void 0 ? {} : { parentAvailable }
      },
      // The sender's local first-send flip mirrors into the list row so the
      // session surfaces (lists filter on blank) before any host frame lands.
      onEngaged: (engaged) => {
        if (this.disposed || !this.retainedIds(this.summaries).has(engaged.sessionId)) return;
        if (!this.engagedSessions.has(engaged.sessionId)) {
          this.engagedSessions.add(engaged.sessionId);
          this.recordMutation({ kind: "engaged", sessionId: engaged.sessionId });
        }
        this.sessions.get(engaged.sessionId)?.handleBlank(false);
      },
      projections: this.projectionStore(sessionId)
    });
  }
  effectiveBlank(summary) {
    return summary.blank && !this.engagedSessions.has(summary.sessionId);
  }
  /**
   * Identities an engagement may still belong to: the given list rows, resident
   * Session instances, and retained child addresses.
   * @param summaries - list rows of the caller's snapshot.
   * @returns the retained identity set.
   */
  retainedIds(summaries) {
    const retained = new Set(summaries.map((summary) => summary.sessionId));
    for (const sessionId of this.sessions.keys()) retained.add(sessionId);
    for (const sessionId of this.addresses.keys()) retained.add(sessionId);
    return retained;
  }
  /**
   * Forget one engagement that no retained identity holds.
   * @param sessionId - identity whose engagement may be dropped.
   * @param retained - identities from {@link retainedIds} for the caller's snapshot.
   */
  pruneEngagement(sessionId, retained) {
    if (!retained.has(sessionId)) this.engagedSessions.delete(sessionId);
  }
  /** Resident per-session projection store (create-on-demand; outlives instantiation). */
  projectionStore(sessionId) {
    let store = this.projectionStores.get(sessionId);
    if (store === void 0) {
      store = new ProjectionValueStore();
      const projections = store;
      store.subscribeAny(() => {
        if (projections.values().sessionListMetadata?.blank === false) {
          this.sessions.get(sessionId)?.handleBlank(false);
        }
        this.notifier.markDirty();
      });
      this.projectionStores.set(sessionId, store);
    }
    return store;
  }
  /**
   * Load a complete projection baseline once per connection; retry unsuccessful reads.
   * @param sessionId - Session to inspect without opening its conversation.
   * @returns completion of the current or newly started read.
   */
  refreshProjections(sessionId) {
    const existing = this.projectionInflight.get(sessionId);
    if (existing !== void 0) return existing.promise;
    if (this.projectionLoads.get(sessionId)?.state === "ready") return Promise.resolve();
    const controller = new AbortController();
    const store = this.projectionStore(sessionId);
    const initialValues = store.values();
    this.projectionLoads.set(sessionId, { state: "loading", error: null });
    this.notifier.markDirty();
    const operation = (async () => {
      try {
        const result = await this.remote.session.projections({ sessionId }, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          if (result.value !== null) {
            store.seed({ ...result.value, asOfSeq: sessionSeqCursor(result.value.asOfSeq) });
          } else if (store.values() === initialValues) {
            store.clear();
          }
          this.projectionLoads.set(sessionId, { state: "ready", error: null });
        } else {
          this.projectionLoads.set(sessionId, { state: "error", error: result.error });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!isRemoteFailure(error)) throw error;
        this.projectionLoads.set(sessionId, { state: "error", error });
      } finally {
        if (!controller.signal.aborted) {
          this.projectionInflight.delete(sessionId);
          this.notifier.markDirty();
        }
      }
    })();
    this.projectionInflight.set(sessionId, { promise: operation, controller });
    return operation;
  }
  agentAvailable(sessionId) {
    return this.summaries.find((summary) => summary.sessionId === sessionId)?.agentAvailable ?? (this.listPhase === "ready" ? false : void 0);
  }
  updateParentAvailability() {
    for (const [childId, address] of this.addresses) {
      const available = this.agentAvailable(address.parentSessionId);
      if (available !== void 0) this.sessions.get(childId)?.handleSubagentParentAvailable(available);
    }
  }
  // ---- List API ----
  /** Full refresh via session.list (single-flight within one Host generation). */
  refreshList() {
    if (this.listInflight !== null) return this.listInflight;
    this.listState = "loading";
    this.listError = null;
    const established = this.summaries;
    const mutations = [];
    this.listMutations = mutations;
    this.notifier.markDirty();
    this.listInflight = (async () => {
      try {
        const result = await this.remote.session.list({});
        if (this.listMutations !== mutations) return;
        if (result.ok) {
          const baseline = this.listPhase === "pending" ? [...result.value.items] : mergeOrderedBaseline(established, result.value.items, (summary) => summary.sessionId);
          const removedSincePull = /* @__PURE__ */ new Set();
          for (const mutation of mutations) {
            if (mutation.kind === "remove") removedSincePull.add(mutation.sessionId);
          }
          for (const s of baseline) {
            if (s.running && !removedSincePull.has(s.sessionId)) this.engagedSessions.add(s.sessionId);
          }
          const summaries = mutations.reduce(applyMutation, baseline);
          this.summaries = summaries;
          const retained = this.retainedIds(summaries);
          for (const sessionId of this.engagedSessions) this.pruneEngagement(sessionId, retained);
          this.listState = "idle";
          this.listPhase = "ready";
          this.updateParentAvailability();
          for (const s of this.summaries) {
            const session = this.sessions.get(s.sessionId);
            if (session === void 0) continue;
            session.handleBlank(this.effectiveBlank(s));
            session.handleRunning(s.running);
          }
          for (const s of result.value.items) {
            if (s.projections !== void 0) this.applyListBlock(s.sessionId, s.projections);
          }
        } else {
          this.listState = "error";
          this.listError = result.error;
        }
      } catch (error) {
        if (!isRemoteFailure(error)) throw error;
        if (this.listMutations !== mutations) return;
        this.listState = "error";
        this.listError = error;
      } finally {
        if (this.listMutations === mutations) {
          this.listMutations = null;
          this.listInflight = null;
          this.notifier.markDirty();
        }
      }
    })();
    return this.listInflight;
  }
  /**
   * Search visible session message content without adding transient query
   * state to the list snapshot.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for superseded UI queries.
   * @returns the Host result or a folded transport error.
   */
  async search(query, signal) {
    const result = await this.remote.session.search({ query }, signal);
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        items: [...result.value.items],
        hasMore: result.value.hasMore
      }
    };
  }
  /**
   * Contract session.create; on success merge into summaries immediately (no
   * wait for the next refresh). A created session is blank by definition
   * (entity birth precedes the first message).
   * @param opts - target workspace or working directory, plus an optional caller-owned id.
   * @returns the create result.
  */
  async create(opts = {}) {
    const shared = opts.sessionId === void 0 ? {} : { sessionId: opts.sessionId };
    const payload = opts.workspaceId !== void 0 ? { workspaceId: opts.workspaceId, ...shared } : { ...opts.cwd === void 0 ? {} : { cwd: opts.cwd }, ...shared };
    const result = await this.remote.session.create(payload);
    if (result.ok) {
      this.recordMutation({ kind: "placeholder", summary: {
        agentAvailable: true,
        sessionId: result.value.sessionId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        ...opts.cwd !== void 0 ? { cwd: opts.cwd } : {}
      } });
    } else {
      const publishedSessionId = workspaceAttachSessionId(result.error);
      if (publishedSessionId !== void 0) {
        this.recordMutation({ kind: "placeholder", summary: {
          agentAvailable: true,
          sessionId: publishedSessionId,
          updatedAt: Date.now(),
          running: false,
          blank: true
        } });
      }
    }
    return result;
  }
  /**
   * Contract session.fork; on success merge the child into summaries
   * immediately (same synchronous-addressability guarantee as create).
   * Blankness starts provisionally true so the authoritative Host summary can
   * preserve it or lower it after an exact cut before the first `turn/start`;
   * lineage rides parentSessionId. A child published before Workspace
   * attachment fails is also reconciled into the list.
   * @param opts - source session and the optional exact inclusive boundary seq.
   * @returns the fork result (the child session id).
   */
  async fork(opts) {
    const source = this.summaries.find((s) => s.sessionId === opts.sessionId);
    const result = await this.remote.session.fork({
      sessionId: opts.sessionId,
      ...opts.atSeq === void 0 ? {} : { atSeq: opts.atSeq }
    });
    const childId = result.ok ? result.value.sessionId : workspaceAttachSessionId(result.error);
    if (childId !== void 0) {
      this.recordMutation({ kind: "placeholder", summary: {
        agentAvailable: true,
        sessionId: childId,
        updatedAt: Date.now(),
        running: false,
        blank: true,
        parentSessionId: opts.sessionId,
        ...source?.cwd !== void 0 ? { cwd: source.cwd } : {}
      } });
    }
    return result;
  }
  /**
   * Rename a Session and update its title projection without opening its history.
   * @param sessionId - Session to rename.
   * @param title - raw title text for Host normalization.
   * @returns the accepted title and event position, or the Remote failure.
   */
  async rename(sessionId, title) {
    const result = await this.remote.session.rename({ sessionId, title });
    if (result.ok) {
      this.projectionStore(sessionId).apply("title", result.value.title, SessionSeq(result.value.seq));
    }
    return result;
  }
  /**
   * Merge a Host summary, replacing live state and filling missing metadata.
   * Local create/fork placeholders only fill metadata on an existing row.
   */
  mergeSummary(summary) {
    this.recordMutation({ kind: "upsert", summary });
    this.updateParentAvailability();
  }
  /** Apply immediately and retain for replay when a list response is in flight. */
  recordMutation(mutation) {
    if (this.disposed) return;
    this.listMutations?.push(mutation);
    this.summaries = applyMutation(this.summaries, mutation);
    this.notifier.markDirty();
  }
  // ---- Subscription API (for useSessionList) ----
  /**
   * uSES subscription entry for useSessionList.
   * @param listener - change callback.
   * @returns the unsubscribe function.
   */
  subscribe(listener) {
    return this.notifier.subscribe(listener);
  }
  /**
   * Cached list snapshot (rebuilt lazily when dirty with no listeners).
   * @returns the cached reference (stable until the next flush).
   */
  getListSnapshot() {
    this.notifier.ensureFresh();
    return this.listSnapshotCache;
  }
  /**
   * Read cached projection values for a Session that may exist only in a loaded subagent catalog.
   * @param sessionId - Session whose control or history baseline supplied projections.
   * @returns current values, or undefined before any projection store exists.
   */
  projectionValues(sessionId) {
    return this.projectionStores.get(sessionId)?.values();
  }
  // ---- Live control and Host-event sinks ----
  /**
   * Apply a complete control baseline or one later replacement frame.
   * @param frame - baseline or live control replacement from Session Controller.
   */
  handleControlFrame(frame) {
    if (frame.type === "baseline") {
      this.replaceControlBaseline(frame.value);
      return;
    }
    this.projectionStore(frame.sessionId).apply(frame.key, frame.value, SessionSeq(frame.seq));
    this.notifier.markDirty();
  }
  replaceControlBaseline(baseline) {
    for (const [sessionId, block] of Object.entries(baseline.projections)) {
      const store = this.projectionStore(sessionId);
      const asOfSeq = sessionSeqCursor(block.asOfSeq);
      store.seed({ ...block, asOfSeq });
    }
    this.notifier.markDirty();
  }
  /**
   * Apply one Session-list addition forwarded through `ctx.remote.$on`.
   * @param summary - current Host summary for the added Session.
   */
  handleSessionAdded(summary) {
    this.mergeSummary(summary);
    if (!this.disposed && summary.running) this.engagedSessions.add(summary.sessionId);
    this.sessions.get(summary.sessionId)?.handleBlank(this.effectiveBlank(summary));
    if (summary.projections !== void 0) this.applyListBlock(summary.sessionId, summary.projections);
  }
  /**
   * Merge one list-surface projection block by the sequence space it declares.
   * A `sequenced` block came from the Host's live registry for an attached
   * Session, so each key lands under higher-seq-wins against that Session's
   * baselines and frames. A `cached` block was viewed from the persisted
   * checkpoint by a header-only listing: its watermark is not comparable with
   * this connection's seqs, so it only fills keys no sequenced row holds.
   */
  applyListBlock(sessionId, block) {
    const store = this.projectionStore(sessionId);
    switch (block.kind) {
      case "sequenced": {
        const seq = sessionSeqCursor(block.asOfSeq);
        for (const [key, value] of Object.entries(block.values)) store.apply(key, value, seq);
        return;
      }
      case "cached":
        store.applyCached(block.values);
        return;
      default:
        assertNever(block.kind, "session list projection block kind");
    }
  }
  /**
   * Apply one Session removal forwarded through `ctx.remote.$on`.
   * @param sessionId - removed Session identity.
   */
  handleSessionRemoved(sessionId) {
    const durableSubagent = this.subagentAddress(sessionId) !== void 0 || this.summaries.some((summary) => summary.sessionId === sessionId && summary.origin === "subagent");
    this.recordMutation(durableSubagent ? { kind: "status", sessionId, running: false, agentAvailable: false } : { kind: "remove", sessionId });
    if (durableSubagent) this.sessions.get(sessionId)?.handleRunning(false);
    else this.sessions.get(sessionId)?.handleRemoved();
    const catalog = this.projectionStores.get(sessionId)?.values().subagentCatalog;
    if (!durableSubagent && (catalog === void 0 || catalog.length === 0)) {
      this.projectionStores.delete(sessionId);
    }
    this.pruneEngagement(sessionId, this.retainedIds(this.summaries));
    this.projectionInflight.get(sessionId)?.controller.abort();
    this.projectionInflight.delete(sessionId);
    this.projectionLoads.delete(sessionId);
    for (const [childId, address] of this.addresses) {
      if (address.parentSessionId === sessionId) {
        this.sessions.get(childId)?.handleSubagentParentAvailable(false);
      }
    }
  }
  /**
   * Apply one live Agent running-state change.
   * @param sessionId - Session whose Agent state changed.
   * @param running - current Agent running state.
   */
  handleSessionStatus(sessionId, running) {
    if (!this.disposed && running) this.engagedSessions.add(sessionId);
    this.recordMutation({ kind: "status", sessionId, running, agentAvailable: true });
    this.updateParentAvailability();
    this.sessions.get(sessionId)?.handleRunning(running);
  }
  /**
   * Advance Session-list activity from one user-authored durable message.
   * @param sessionId - Session whose activity changed.
   * @param updatedAt - durable message timestamp.
   */
  handleSessionActivity(sessionId, updatedAt) {
    this.recordMutation({ kind: "activity", sessionId, updatedAt });
  }
  /**
   * Surface one live Agent failure on an already-materialized Session.
   * @param sessionId - Session whose Agent failed.
   * @param message - caller-visible failure description.
   */
  handleSessionError(sessionId, message) {
    this.sessions.get(sessionId)?.handleAgentError(message);
  }
  /**
   * Repair one re-established Host-event generation with queryable baselines.
   * Discard old projection cuts before new queries, including cold Sessions
   * absent from the process-local control baseline.
   * Opened Session follow streams resume independently through API Gateway.
   */
  handleConnected() {
    for (const store of this.projectionStores.values()) store.clear();
    this.listMutations = null;
    this.listInflight = null;
    void this.refreshList();
    const parents = new Set(this.projectionLoads.keys());
    for (const id of this.sessions.keys()) {
      const address = this.addresses.get(id);
      if (address !== void 0) parents.add(address.parentSessionId);
    }
    for (const { controller } of this.projectionInflight.values()) controller.abort();
    this.projectionInflight.clear();
    this.projectionLoads.clear();
    for (const parentSessionId of parents) void this.refreshProjections(parentSessionId);
  }
  buildListSnapshot() {
    const merged = this.summaries.map((summary) => {
      const projectionStore = this.projectionStores.get(summary.sessionId);
      const title = projectionStore?.get("title");
      const projectionValues = projectionStore?.values();
      const metadata = projectionValues?.sessionListMetadata;
      return {
        ...summary,
        // Cached list hints can precede a history opening or control update.
        blank: this.effectiveBlank(summary) && metadata?.blank !== false,
        updatedAt: Math.max(summary.updatedAt, metadata?.lastPromptAt ?? 0),
        ...typeof title === "string" && title !== "" ? { title } : {},
        ...projectionValues === void 0 ? {} : { projectionValues }
      };
    });
    const fresh = flattenLineage(merged);
    const items = fresh.map((entry) => {
      const prev = this.entryCache.get(entry.sessionId);
      if (prev !== void 0 && prev.updatedAt === entry.updatedAt && prev.running === entry.running && prev.blank === entry.blank && prev.parentSessionId === entry.parentSessionId && prev.cwd === entry.cwd && prev.origin === entry.origin && prev.title === entry.title && prev.depth === entry.depth && prev.projectionValues === entry.projectionValues) return prev;
      this.entryCache.set(entry.sessionId, entry);
      return entry;
    });
    const itemIds = new Set(items.map((entry) => entry.sessionId));
    for (const id of this.entryCache.keys()) {
      if (!itemIds.has(id)) this.entryCache.delete(id);
    }
    const sameOrder = items.length === this.itemsCache.length && items.every((e, i) => e === this.itemsCache[i]);
    if (!sameOrder) this.itemsCache = items;
    return {
      items: this.itemsCache,
      state: this.listState,
      phase: this.listPhase,
      error: this.listError,
      projectionsBySession: Object.fromEntries([...this.projectionStores].map(([sessionId, store]) => [
        sessionId,
        { values: store.values(), state: "idle", error: null, ...this.projectionLoads.get(sessionId) }
      ]))
    };
  }
};
function applyMutation(summaries, mutation) {
  switch (mutation.kind) {
    case "upsert":
    case "placeholder": {
      const existing = summaries.find((summary) => summary.sessionId === mutation.summary.sessionId);
      if (existing === void 0) return [mutation.summary, ...summaries];
      const filled = {
        ...existing,
        // Blank only lowers: a stale true (session-added racing the local
        // first send) never re-hides an already-surfaced session.
        blank: existing.blank && mutation.summary.blank,
        ...mutation.kind === "upsert" ? {
          agentAvailable: mutation.summary.agentAvailable,
          running: mutation.summary.running
        } : {},
        ...existing.cwd === void 0 && mutation.summary.cwd !== void 0 ? { cwd: mutation.summary.cwd } : {},
        ...existing.parentSessionId === void 0 && mutation.summary.parentSessionId !== void 0 ? { parentSessionId: mutation.summary.parentSessionId } : {},
        ...existing.origin === void 0 && mutation.summary.origin !== void 0 ? { origin: mutation.summary.origin } : {}
      };
      if (filled.cwd === existing.cwd && filled.parentSessionId === existing.parentSessionId && filled.origin === existing.origin && filled.blank === existing.blank && filled.agentAvailable === existing.agentAvailable && filled.running === existing.running) return [...summaries];
      return summaries.map((summary) => summary.sessionId === mutation.summary.sessionId ? filled : summary);
    }
    case "remove":
      return summaries.filter((summary) => summary.sessionId !== mutation.sessionId);
    case "status":
      return summaries.map((summary) => summary.sessionId === mutation.sessionId && (summary.running !== mutation.running || summary.agentAvailable !== mutation.agentAvailable || mutation.running && summary.blank) ? { ...summary, running: mutation.running, agentAvailable: mutation.agentAvailable, blank: summary.blank && !mutation.running } : summary);
    case "activity":
      return summaries.map((summary) => summary.sessionId === mutation.sessionId && mutation.updatedAt > summary.updatedAt ? { ...summary, updatedAt: mutation.updatedAt } : summary);
    case "engaged":
      return summaries.map((summary) => summary.sessionId === mutation.sessionId && summary.blank ? { ...summary, blank: false } : summary);
  }
}
function workspaceAttachSessionId(error) {
  return error.code === "session/workspace-attach-failed" ? error.details.sessionId : void 0;
}

// vendor/dsh-session-controller/packages/util/workspace-path/src/index.ts
function workspaceTitleOf(path) {
  const trimmed = path.replace(/[/\\]+$/, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(separator + 1);
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/scope.ts
import { Context as CordisContext } from "@deepseek-ai/cordis";
var kScope = Symbol("dsh.client.scope");
function agentScope() {
}
function createScope2(ctx, key) {
  const fiber = ctx.plugin(agentScope);
  const identity = { sessionId: key };
  const scoped = fiber.ctx.extend({
    [kScope]: identity,
    [CordisContext.filter](listenerCtx) {
      const tag = scopeIdentityOf(listenerCtx);
      return tag === void 0 || tag === identity;
    }
  });
  return {
    fiber,
    ctx: scoped
  };
}
function scopeOf(ctx) {
  return scopeIdentityOf(ctx)?.sessionId;
}
function scopeIdentityOf(ctx) {
  return ctx[kScope];
}

// vendor/dsh-session-controller/packages/api/session-controller/src/client/sessions/service.ts
var SessionCreateError = class extends Error {
  /**
   * @param rpcError - Host business or folded transport error.
   * @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
   */
  constructor(rpcError, requestedSessionId) {
    super(`session create failed: ${rpcError.code}: ${rpcError.message}`);
    this.rpcError = rpcError;
    this.requestedSessionId = requestedSessionId;
  }
  name = "SessionCreateError";
};
var SessionForkError = class extends Error {
  /**
   * @param rpcError - Host business or folded transport error.
   * @param sourceSessionId - the session the fork was cut from.
   */
  constructor(rpcError, sourceSessionId) {
    super(`session fork failed: ${rpcError.code}: ${rpcError.message}`);
    this.rpcError = rpcError;
    this.sourceSessionId = sourceSessionId;
  }
  name = "SessionForkError";
};
function displayTitleOf(title, cwd, id) {
  if (title !== void 0) return title;
  if (cwd !== void 0 && cwd !== "") {
    const base = workspaceTitleOf(cwd);
    if (base !== "") return base;
  }
  return id;
}
function increasedForkTitle(title) {
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title);
  if (ascii?.[1] !== void 0 && ascii[2] !== void 0) {
    return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`;
  }
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title);
  if (fullWidth?.[1] !== void 0 && fullWidth[2] !== void 0) {
    return `${fullWidth[1]}\uFF08${BigInt(fullWidth[2]) + 1n}\uFF09`;
  }
  return `${title} (1)`;
}
function freezeRetainedBy(counts) {
  Object.setPrototypeOf(counts, null);
  return Object.freeze(counts);
}
var EMPTY_RETAIN_INFO = Object.freeze({ referenceCount: 0, retainedBy: freezeRetainedBy({}) });
async function waitForOpen(opening, signal) {
  if (signal === void 0) return opening;
  const aborted = Promise.withResolvers();
  const onAbort = () => {
    aborted.reject(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    await Promise.race([opening, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
var ClientSessionReference = class {
  constructor(sessionId, record, releaseReference) {
    this.sessionId = sessionId;
    this.record = record;
    this.releaseReference = releaseReference;
    void this.ready.catch(() => {
    });
  }
  released = new AbortController();
  readiness = Promise.withResolvers();
  ready = this.readiness.promise;
  get binding() {
    if (this.record === void 0 || !this.record.live) throw new Error(`Session reference "${this.sessionId}" is released`);
    return this.record.binding;
  }
  attachOpening(opening, signal) {
    const waitSignal = signal === void 0 ? this.released.signal : AbortSignal.any([this.released.signal, signal]);
    void waitForOpen(opening, waitSignal).then(
      () => {
        try {
          waitSignal.throwIfAborted();
          this.readiness.resolve(this.binding);
        } catch (error) {
          this.readiness.reject(error);
        }
      },
      (error) => {
        this.readiness.reject(error);
      }
    );
  }
  release() {
    const reason = new Error(`Session reference "${this.sessionId}" is released`);
    const release = this.releaseReference;
    this.released.abort(reason);
    this.readiness.reject(reason);
    this.record = void 0;
    this.releaseReference = void 0;
    release?.();
  }
  [Symbol.dispose]() {
    this.release();
  }
};
var ClientSessions = class {
  /**
   * @param ctx - client root context (scope fibers mount under it).
   * @param remote - generated Remote namespaces shared with every Session.
   */
  constructor(rootCtx, remote) {
    this.rootCtx = rootCtx;
    this.manager = new SessionManager(remote);
    this.list = createSnapshotStore({
      ids: [],
      byId: {},
      phase: "pending",
      projectionsBySession: {}
    });
    const disposeManagerProjection = this.manager.subscribe(() => {
      this.projectList();
    });
    rootCtx.effect(() => async () => {
      this.closed = true;
      disposeManagerProjection();
      const scopes = [...this.scopes];
      this.scopes.clear();
      for (const [, record] of scopes) {
        record.live = false;
        record.session.unbindScope();
      }
      const managerDisposal = this.manager.dispose();
      for (const [id, record] of scopes) {
        this.startScopeDrop(id, record);
        this.publishRetention(id);
      }
      await this.drainScopeDrops();
      await managerDisposal;
    }, "session-controller.client.sessions");
    rootCtx.reflect.provide("sessions", this, void 0);
  }
  /**
   * The wire schema's own result bound, re-exposed for presentation plugins as
   * injected data. Not per-connection state: the `session.search` response
   * schema caps `items` at this constant, so every transport (fixture included)
   * reports the same number.
   */
  searchResultLimit = SESSION_SEARCH_RESULT_LIMIT;
  /** Catalog metadata and local reference-source projection. */
  list;
  /** The object-layer instance cluster and frame dispatch entry. */
  manager;
  scopes = /* @__PURE__ */ new Map();
  /** Stable per-id sources retained for the Client root lifetime, including across generation replacement. */
  retainObservers = /* @__PURE__ */ new Map();
  scopeDrops = /* @__PURE__ */ new Set();
  closed = false;
  retain(target, options) {
    const { source, signal } = options;
    signal?.throwIfAborted();
    if (this.closed) throw new Error("Session Controller is disposed");
    const id = this.manager.resolveTarget(target);
    const reference = this.retainScope(id, source);
    try {
      reference.attachOpening(this.manager.get(id).open(), signal);
      return reference;
    } catch (error) {
      reference.release();
      throw error;
    }
  }
  async using(target, options, operation) {
    const reference = this.retain(target, options);
    try {
      await reference.ready;
      return await operation(reference);
    } finally {
      reference.release();
    }
  }
  retainInfo(id) {
    let observer = this.retainObservers.get(id);
    if (observer === void 0) {
      const listeners = /* @__PURE__ */ new Set();
      observer = {
        listeners,
        published: this.retentionSnapshot(id),
        source: {
          getSnapshot: () => this.retentionSnapshot(id),
          subscribe: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          }
        }
      };
      this.retainObservers.set(id, observer);
    }
    return observer.source;
  }
  /**
   * Resolve an already discovered direct-parent address without opening it.
   * Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
   * @param id - possible addressed child id.
   * @returns A retained or loaded-catalog address, without retaining a new selection or scope.
   */
  subagentAddress(id) {
    return this.manager.subagentAddress(id);
  }
  /**
   * Load all Session projections once per connection; retry an unsuccessful initial read.
   * @param sessionId - Session to inspect without opening its conversation.
   */
  refreshProjections(sessionId) {
    return this.manager.refreshProjections(sessionId);
  }
  /**
   * Refresh the real Session baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started baseline pull.
   */
  refresh() {
    return this.manager.refreshList();
  }
  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results or a business/transport error.
   */
  search(query, signal) {
    return this.manager.search(query, signal);
  }
  /**
   * Apply one Session Controller live-control frame.
   * @param frame - baseline or live control replacement.
   */
  handleControlFrame(frame) {
    this.manager.handleControlFrame(frame);
  }
  /**
   * Apply one remotely forwarded Session-list addition.
   * @param summary - current Host summary for the added Session.
   */
  handleSessionAdded(summary) {
    this.manager.handleSessionAdded(summary);
  }
  /**
   * Apply one remotely forwarded Session removal.
   * @param sessionId - removed Session identity.
   */
  handleSessionRemoved(sessionId) {
    this.manager.handleSessionRemoved(sessionId);
  }
  /**
   * Apply one remotely forwarded running-state change.
   * @param args - Session identity and current Agent running state.
   */
  handleSessionStatus(...args) {
    this.manager.handleSessionStatus(...args);
  }
  /**
   * Apply one remotely forwarded list-activity change.
   * @param args - Session identity and durable activity timestamp.
   */
  handleSessionActivity(...args) {
    this.manager.handleSessionActivity(...args);
  }
  /**
   * Apply one remotely forwarded Agent failure.
   * @param args - Session identity and caller-visible failure description.
   */
  handleSessionError(...args) {
    this.manager.handleSessionError(...args);
  }
  /** Rebuild the Session baseline and every opened window after connection. */
  handleConnected() {
    this.manager.handleConnected();
  }
  /**
   * Create a Host Session and publish its catalog row before resolving.
   * Callers retain the returned identity before borrowing its binding.
   * @param opts - target workspace or directory and an optional preallocated id.
   * @returns the new session id.
   * @throws {SessionCreateError} with the requested id.
   */
  async create(opts = {}) {
    const result = await this.manager.create(opts);
    if (!result.ok) throw new SessionCreateError(result.error, opts.sessionId);
    this.projectList();
    return result.value.sessionId;
  }
  /**
   * Fork a session from an exact inclusive prefix of the source (same
   * synchronous-addressability guarantee as {@link ClientSessions.create}:
   * on resolution the child is catalogued and may be explicitly retained).
   * @param opts - source session id, the optional exact inclusive boundary
   *   seq (a real event seq the caller already knows; a cut inside an open
   *   turn is balanced Host-side with synthetic closers, and omission selects
   *   the latest completed-turn prefix), and whether to increment an
   *   inherited durable title before resolving.
   * @returns the child session id.
   * @throws {SessionForkError} with the source id.
   * @throws {Error} when a requested child-title rename fails after creation.
   */
  async fork(opts) {
    const sourceTitle = opts.increaseTitle ? this.list.getSnapshot().byId[opts.sessionId]?.title : void 0;
    const result = await this.manager.fork({
      sessionId: opts.sessionId,
      ...opts.atSeq === void 0 ? {} : { atSeq: SessionSeq(opts.atSeq) }
    });
    if (!result.ok) throw new SessionForkError(result.error, opts.sessionId);
    this.projectList();
    const childId = result.value.sessionId;
    opts.onCreated?.(childId);
    if (sourceTitle !== void 0) {
      const renamed = await this.manager.rename(childId, increasedForkTitle(sourceTitle));
      if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`);
    }
    return childId;
  }
  /**
   * Borrow an already-retained Agent-scoped Context.
   * @param id - session id (the agent identity — 1:1 same axis).
   * @returns the scoped Context, or undefined without a retained generation.
   */
  scope(id) {
    return this.scopes.get(id)?.ctx;
  }
  /**
   * Retain a validated Gateway identity synchronously, without history or catalog I/O.
   * @param id - Host-projected Session identity, possibly not yet catalogued.
   * @returns a Gateway-source reference owned by the invocation.
   */
  retainAgentScope(id) {
    if (this.closed) throw new Error("Session Controller is disposed");
    return this.retainScope(id, "gateway");
  }
  /**
   * Read the Agent scope tag off a context. Service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions — a cross-bundle
   * value import of the standalone helper would inline a second module
   * instance whose private tag Symbol never matches.
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  scopeOf(ctx) {
    return scopeOf(ctx);
  }
  /**
   * Resolve the business Session behind an Agent-scoped context — the one
   * hop every scoped consumer (event listeners, per-session controllers)
   * takes from ctx-space into object-space (the client mirror of host
   * `agent.session`). Same service-method boundary as
   * {@link ClientSessions.scopeOf}.
   * @param ctx - an Agent-scoped context.
   * @returns the matching live Session, or undefined for an untagged or ended generation.
   */
  sessionOf(ctx) {
    const id = scopeOf(ctx);
    if (id === void 0) return void 0;
    const record = this.scopes.get(id);
    return record !== void 0 && scopeIdentityOf(record.ctx) === scopeIdentityOf(ctx) ? record.binding.session : void 0;
  }
  /**
   * Borrow an already-retained binding without extending its lifetime.
   * @param id - Session identity.
   * @returns the live binding, or undefined without a retained generation.
   */
  binding(id) {
    return this.scopes.get(id)?.binding;
  }
  retainScope(id, source) {
    const record = this.scopes.get(id) ?? this.materializeScope(id);
    const previous = record.retention;
    record.retention = Object.freeze({
      referenceCount: previous.referenceCount + 1,
      retainedBy: freezeRetainedBy({ ...previous.retainedBy, [source]: (previous.retainedBy[source] ?? 0) + 1 })
    });
    const reference = new ClientSessionReference(id, record, () => {
      if (!record.live) return;
      const count = record.retention.referenceCount - 1;
      const { [source]: sourceCount = 0, ...otherSources } = record.retention.retainedBy;
      const retainedBy = sourceCount > 1 ? { ...otherSources, [source]: sourceCount - 1 } : otherSources;
      record.retention = count === 0 ? EMPTY_RETAIN_INFO : Object.freeze({ referenceCount: count, retainedBy: freezeRetainedBy(retainedBy) });
      if (count === 0) this.retireScope(id, record);
      else this.publishRetention(id);
    });
    if (this.list.getSnapshot().byId[id] === void 0 && this.manager.subagentAddress(id) !== void 0) {
      this.projectList();
    }
    this.publishRetention(id);
    return reference;
  }
  retentionSnapshot(id) {
    return this.scopes.get(id)?.retention ?? EMPTY_RETAIN_INFO;
  }
  publishRetention(id) {
    const state = this.list.getSnapshot();
    const row = state.byId[id];
    const retainedBy = this.retentionSnapshot(id).retainedBy;
    if (row !== void 0 && row.retainedBy !== retainedBy) {
      this.list.set({ ...state, byId: { ...state.byId, [id]: { ...row, retainedBy } } });
    }
    const observer = this.retainObservers.get(id);
    const snapshot = this.retentionSnapshot(id);
    if (observer === void 0 || observer.published === snapshot) return;
    observer.published = snapshot;
    notifySubscribers(observer.listeners, "[session-controller] reference sources");
  }
  retireScope(id, record, disposeFiber = true) {
    if (!record.live) return;
    record.live = false;
    if (this.scopes.get(id) === record) this.scopes.delete(id);
    record.session.unbindScope();
    const sessionDisposal = this.manager.drop(id, record.session);
    this.projectList();
    this.publishRetention(id);
    this.startScopeDrop(id, record, disposeFiber, sessionDisposal);
  }
  /** Materialize one scope after its caller establishes that the id may be addressed. */
  materializeScope(id) {
    const { fiber, ctx } = createScope2(this.rootCtx, id);
    const session = this.manager.get(id);
    session.bindScope(ctx);
    const binding = { sessionId: id, session, eventSource: session.eventSource, ctx };
    const record = {
      fiber,
      ctx,
      binding,
      session,
      retention: EMPTY_RETAIN_INFO,
      live: true
    };
    this.scopes.set(id, record);
    ctx.effect(() => () => {
      this.retireScope(id, record, false);
    }, "session-controller: exact generation");
    return record;
  }
  /** Project the manager's list snapshot into the store (title derivation is display-only). */
  projectList() {
    const previousById = this.list.getSnapshot().byId;
    const {
      items,
      phase,
      projectionsBySession
    } = this.manager.getListSnapshot();
    const ids = [];
    const byId = {};
    for (const entry of items) {
      ids.push(entry.sessionId);
      byId[entry.sessionId] = {
        id: entry.sessionId,
        displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
        running: entry.running,
        retainedBy: this.retentionSnapshot(entry.sessionId).retainedBy,
        blank: entry.blank,
        updatedAt: entry.updatedAt,
        ...entry.projectionValues === void 0 ? {} : { projectionValues: entry.projectionValues },
        ...entry.title !== void 0 ? { title: entry.title } : {},
        ...entry.cwd !== void 0 ? { cwd: entry.cwd } : {},
        ...entry.parentSessionId !== void 0 ? { parentId: entry.parentSessionId } : {},
        ...entry.origin !== void 0 ? { origin: entry.origin } : {}
      };
    }
    for (const [parentId, projection] of Object.entries(projectionsBySession)) {
      for (const child of projection.values.subagentCatalog ?? []) {
        const childId = child.id;
        const summary = byId[childId];
        const projectionValues = summary?.projectionValues ?? this.manager.projectionValues(childId);
        const projectedTitle = projectionValues?.title;
        const title = typeof projectedTitle === "string" && projectedTitle !== "" ? projectedTitle : void 0;
        const displayTitle = title ?? child.label ?? childId;
        if (summary === void 0) {
          byId[childId] = {
            id: childId,
            displayTitle,
            parentId,
            origin: "subagent",
            running: this.scopes.get(childId)?.session.getSnapshot().running ?? false,
            blank: false,
            updatedAt: 0,
            retainedBy: this.retentionSnapshot(childId).retainedBy,
            ...projectionValues === void 0 ? {} : { projectionValues },
            ...title === void 0 ? {} : { title }
          };
        } else if (summary.displayTitle !== displayTitle || summary.projectionValues !== projectionValues) {
          byId[childId] = {
            ...summary,
            displayTitle,
            ...projectionValues === void 0 ? {} : { projectionValues }
          };
        }
      }
    }
    for (const [id, record] of this.scopes) {
      if (byId[id] !== void 0) continue;
      const address = this.manager.subagentAddress(id);
      if (address === void 0) continue;
      const previous = previousById[id];
      const snapshot = record.session.getSnapshot();
      const projectionValues = this.manager.projectionValues(id);
      const projectedTitle = projectionValues?.title;
      const title = typeof projectedTitle === "string" && projectedTitle !== "" ? projectedTitle : previous?.title;
      byId[id] = {
        ...previous ?? { id, displayTitle: id, updatedAt: 0 },
        running: snapshot.running,
        retainedBy: record.retention.retainedBy,
        blank: snapshot.blank,
        parentId: address.parentSessionId,
        origin: "subagent",
        ...projectionValues === void 0 ? {} : { projectionValues },
        ...title === void 0 ? {} : { title, displayTitle: title }
      };
    }
    this.list.set({ ids, byId, phase, projectionsBySession });
  }
  startScopeDrop(id, record, disposeFiber = true, sessionDisposal = this.manager.drop(id, record.session)) {
    const drop = this.dropScope(record, disposeFiber, sessionDisposal);
    this.scopeDrops.add(drop);
    void drop.then(
      () => {
        this.scopeDrops.delete(drop);
      },
      () => {
        this.scopeDrops.delete(drop);
      }
    );
  }
  async drainScopeDrops() {
    while (this.scopeDrops.size > 0) {
      await Promise.allSettled([...this.scopeDrops]);
    }
  }
  /** Await the already-withdrawn Session and scoped cleanup to quiescence. */
  async dropScope(record, disposeFiber, sessionDisposal) {
    await Promise.allSettled([sessionDisposal, ...disposeFiber ? [record.fiber.dispose()] : []]);
  }
};

// vendor/dsh-session-controller/packages/api/gateway/src/client/remote-stream.ts
var RemoteStream = class {
  /**
   * @param connection - observable Host generation source used to pace retries.
   * @param options - domain stream opener, end classification, and diagnostics.
   */
  constructor(connection, options) {
    this.connection = connection;
    this.options = options;
  }
  lifetime = new AbortController();
  generationAbort;
  iterator;
  closing;
  revision = 0;
  taken = false;
  /** Cancellation lifetime shared by the stream and sibling page requests. */
  get signal() {
    return this.lifetime.signal;
  }
  /** Interrupt the current generation and immediately request a replacement. */
  restart() {
    if (this.lifetime.signal.aborted) return;
    this.revision++;
    this.generationAbort?.abort(new Error(`${this.options.name} generation restarted`));
  }
  /**
   * Permanently stop this stream and wait for its iterator to close.
   * @returns when the active generation and consumer iterator are quiescent.
   */
  dispose() {
    if (this.closing !== void 0) return this.closing;
    if (!this.lifetime.signal.aborted) {
      const reason = new Error(`${this.options.name} disposed`);
      this.lifetime.abort(reason);
      this.generationAbort?.abort(reason);
    }
    const iterator = this.iterator;
    if (iterator === void 0) return Promise.resolve();
    const closing = closeRemoteStreamIterator(iterator);
    this.closing = closing;
    return closing;
  }
  /** @inheritdoc */
  [Symbol.asyncIterator]() {
    if (this.taken) throw new Error(`${this.options.name} already has a consumer`);
    this.taken = true;
    const iterator = this.read();
    this.iterator = iterator;
    return iterator;
  }
  async *read() {
    let attempt = 0;
    let generation = 0;
    let observedRevision = this.revision;
    try {
      while (!isAborted(this.lifetime.signal)) {
        if (observedRevision !== this.revision) {
          observedRevision = this.revision;
          attempt = 0;
        }
        const revision = this.revision;
        const generationAbort = new AbortController();
        this.generationAbort = generationAbort;
        const signal = AbortSignal.any([this.lifetime.signal, generationAbort.signal]);
        const generationId = ++generation;
        let accepted = false;
        try {
          for await (const value of this.options.open(signal)) {
            if (isAborted(this.lifetime.signal)) return;
            if (revision !== this.revision) break;
            yield {
              generation: generationId,
              value,
              signal,
              accept: () => {
                if (this.generationAbort !== generationAbort || revision !== this.revision) return;
                accepted = true;
                attempt = 0;
              }
            };
          }
          if (isAborted(this.lifetime.signal)) return;
          if (revision !== this.revision) continue;
          throw this.options.ended(accepted);
        } catch (error) {
          if (isAborted(this.lifetime.signal)) return;
          if (revision !== this.revision) continue;
          if (!(error instanceof RemoteStreamCarrierError)) throw terminalStreamFailure(error);
          this.options.carrierFailed?.(error);
          if (revision !== this.revision) continue;
          attempt++;
          try {
            await waitForRemoteStreamRetry(this.connection, error, attempt, signal);
          } catch (retryError) {
            if (isAborted(this.lifetime.signal)) return;
            if (revision !== this.revision) continue;
            throw terminalStreamFailure(retryError);
          }
        } finally {
          this.generationAbort = void 0;
          if (!generationAbort.signal.aborted) {
            generationAbort.abort(new Error(`${this.options.name} generation ended`));
          }
        }
      }
    } finally {
      if (!this.lifetime.signal.aborted) {
        this.lifetime.abort(new Error(`${this.options.name} consumer closed`));
      }
      this.generationAbort?.abort(this.lifetime.signal.reason);
      this.generationAbort = void 0;
    }
  }
};
async function waitForRemoteStreamRetry(connection, error, attempt, signal) {
  signal.throwIfAborted();
  if (connection.generation.getSnapshot() !== void 0) {
    if (attempt === 1) return;
    throw error;
  }
  await new Promise((resolve, reject) => {
    const subscription = { finished: false };
    const finish = (failure) => {
      if (subscription.finished) return;
      subscription.finished = true;
      subscription.dispose?.();
      signal.removeEventListener("abort", aborted);
      if (failure === void 0) resolve();
      else reject(failure);
    };
    const inspect = () => {
      if (connection.generation.getSnapshot() !== void 0) finish();
    };
    const aborted = () => {
      finish(new Error("Remote stream retry aborted", { cause: signal.reason }));
    };
    const dispose = connection.generation.subscribe(inspect);
    subscription.dispose = dispose;
    if (subscription.finished) dispose();
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else inspect();
  });
}
function terminalStreamFailure(error) {
  return remoteErrorOf(error) ?? new RemoteError(
    "gateway/internal",
    error instanceof Error ? error.message : String(error),
    {},
    { cause: error }
  );
}
function isAborted(signal) {
  return signal.aborted;
}
async function closeRemoteStreamIterator(iterator) {
  try {
    await iterator.return?.();
  } catch {
  }
}
export {
  ClientSessions,
  RemoteError,
  RemoteStream,
  RemoteStreamCarrierError,
  Session,
  SessionManager,
  createSessionControlStream,
  scopeOf
};
