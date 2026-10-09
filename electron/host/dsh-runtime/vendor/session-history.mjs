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
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// vendor/dsh-session-controller/packages/util/deque/src/index.ts
var MIN_CAPACITY = 16;
var Deque = class {
  buffer = new Array(MIN_CAPACITY);
  head = 0;
  count = 0;
  /** Number of entries available to remove. */
  get size() {
    return this.count;
  }
  /**
   * Append one entry after the current tail.
   * @param value - entry to append.
   */
  pushBack(value) {
    this.ensureCapacity();
    const tail = this.head + this.count;
    this.buffer[tail < this.buffer.length ? tail : tail - this.buffer.length] = value;
    this.count += 1;
  }
  /**
   * Insert one entry before the current head.
   * @param value - entry to prepend.
   */
  pushFront(value) {
    this.ensureCapacity();
    this.head = this.head === 0 ? this.buffer.length - 1 : this.head - 1;
    this.buffer[this.head] = value;
    this.count += 1;
  }
  /**
   * Remove the current head entry and clear its retained reference.
   * Callers whose element type includes `undefined` use {@link size} to
   * distinguish an empty deque from an `undefined` entry.
   * @returns the removed entry, or `undefined` when the deque is empty.
   */
  popFront() {
    if (this.count === 0) return void 0;
    const value = this.buffer[this.head];
    this.buffer[this.head] = void 0;
    this.head += 1;
    if (this.head === this.buffer.length) this.head = 0;
    this.count -= 1;
    this.compact();
    return value;
  }
  /** Drop every entry and release the current backing storage. */
  clear() {
    this.buffer = new Array(MIN_CAPACITY);
    this.head = 0;
    this.count = 0;
  }
  ensureCapacity() {
    if (this.count < this.buffer.length) return;
    this.resize(this.buffer.length * 2);
  }
  compact() {
    if (this.count === 0) {
      this.head = 0;
      return;
    }
    if (this.buffer.length > MIN_CAPACITY && this.count <= this.buffer.length / 4) {
      this.resize(Math.max(MIN_CAPACITY, this.buffer.length / 2));
    }
  }
  resize(capacity) {
    const next = new Array(capacity);
    let source = this.head;
    for (let index = 0; index < this.count; index += 1) {
      next[index] = this.buffer[source];
      source += 1;
      if (source === this.buffer.length) source = 0;
    }
    this.buffer = next;
    this.head = 0;
  }
};

// vendor/dsh-session-controller/packages/api/session-controller/src/history.ts
import {
  isAppendSurfaceEvent,
  SessionLogOffset,
  SessionSeq
} from "@deepseek-ai/dsh-session";
import { SessionQueryError } from "@deepseek-ai/dsh-session-query";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";

// vendor/dsh-session-controller/packages/api/session-controller/src/assistant-stream.ts
import { AssistantStreamAccumulator } from "@deepseek-ai/dsh-llm";
var EMPTY_BASELINE = { revision: 0 };
var SessionAssistantStreamAccumulator = class {
  activeAttempt;
  revision = 0;
  snapshotValue = EMPTY_BASELINE;
  dirty = false;
  /**
   * Fold one trusted frame from the current attached Agent lifecycle.
   * @param frame - next dense process-local Assistant frame.
   * @param durableCursor - last committed Session seq when this frame was observed.
   */
  accept(frame, durableCursor) {
    if (frame.type === "start" && frame.revision === 1 && this.revision !== 0) {
      this.activeAttempt = void 0;
      this.revision = 0;
    }
    if (frame.revision !== this.revision + 1) {
      this.activeAttempt = void 0;
      this.revision = frame.revision;
      this.dirty = true;
      return;
    }
    this.revision = frame.revision;
    switch (frame.type) {
      case "start":
        this.activeAttempt = {
          attemptId: frame.attemptId,
          startedAfterSeq: durableCursor,
          turn: frame.turn,
          step: frame.step,
          stream: new AssistantStreamAccumulator(),
          nextIndex: 0
        };
        break;
      case "chunk": {
        const attempt = this.activeAttempt;
        if (attempt === void 0 || attempt.attemptId !== frame.attemptId || frame.index !== attempt.nextIndex) {
          this.activeAttempt = void 0;
          break;
        }
        attempt.stream.push({ time: frame.time, chunk: frame.chunk });
        attempt.nextIndex += 1;
        break;
      }
      case "end":
        this.activeAttempt = void 0;
        break;
    }
    this.dirty = true;
  }
  /**
   * Read the cached reconnect baseline, materializing it after a state change.
   * @returns the identity-stable baseline for the latest accepted revision.
   */
  snapshot() {
    if (!this.dirty) return this.snapshotValue;
    this.snapshotValue = {
      revision: this.revision,
      ...this.activeAttempt === void 0 ? {} : {
        activeAttempt: {
          attemptId: this.activeAttempt.attemptId,
          startedAfterSeq: this.activeAttempt.startedAfterSeq,
          turn: this.activeAttempt.turn,
          step: this.activeAttempt.step,
          nextIndex: this.activeAttempt.nextIndex,
          stream: this.activeAttempt.stream.snapshot()
        }
      }
    };
    this.dirty = false;
    return this.snapshotValue;
  }
};

// vendor/dsh-session-controller/packages/api/session-controller/src/history.ts
var DEFAULT_MAX_MESSAGES = 50;
var MESSAGE_TYPES = /* @__PURE__ */ new Set(["user/message", "assistant/message"]);
var SessionHistoryController = class {
  /**
   * @param ctx - Host context carrying Session query and projection services.
   * @param promote - starts ordinary Session activation after snapshot delivery.
   */
  constructor(ctx, promote) {
    this.ctx = ctx;
    this.promote = promote;
    ctx.on("agent/assistant-stream", ({ agent, frame }) => {
      let stream = this.assistantStreams.get(agent.session.id);
      if (stream === void 0) {
        stream = new SessionAssistantStreamAccumulator();
        this.assistantStreams.set(agent.session.id, stream);
      }
      stream.accept(frame, cursorBeforeNext(agent.session.seq));
    }, { global: true });
    ctx.on("agent/disposed", ({ agent }) => {
      this.assistantStreams.delete(agent.session.id);
    }, { global: true });
    ctx.effect(() => () => {
      for (const close of this.closeFollowers) close();
      this.closeFollowers.clear();
    }, "session-controller.history");
  }
  closeFollowers = /* @__PURE__ */ new Set();
  assistantStreams = /* @__PURE__ */ new Map();
  /**
   * Read one message-aligned history page without activating an Agent.
   * @param request - durable address and backwards-page cursor.
   * @param signal - caller cancellation for persistence reads.
   * @returns a contiguous event page.
   */
  async page(request, signal) {
    var _stack = [];
    try {
      validatePageRequest(request);
      const throughSeq = request.throughSeq === -1 ? -1 : SessionSeq(request.throughSeq);
      const beforeSeq = request.beforeSeq === void 0 ? void 0 : SessionLogOffset(request.beforeSeq);
      const source = __using(_stack, await this.sourceFor(request.address, signal, false));
      signal.throwIfAborted();
      const sourceLog = source.events;
      const sourceCursor = sourceLog.at(-1)?.seq ?? -1;
      if (throughSeq > sourceCursor) {
        throw new RemoteError(
          "gateway/bad-request",
          `session page through seq ${String(throughSeq)} is past cursor ${String(sourceCursor)}`,
          {}
        );
      }
      if (throughSeq >= 0 && sourceLog[throughSeq]?.seq !== throughSeq) {
        throw new RemoteError("gateway/internal", `session log does not contain through seq ${String(throughSeq)}`, {});
      }
      const page = paginate(
        sourceLog,
        beforeSeq,
        request.maxMessages ?? DEFAULT_MAX_MESSAGES,
        throughSeq,
        request.turnWindow
      );
      const records = pageRecords(page.events);
      return {
        records,
        hasMore: page.hasMore
      };
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /**
   * Follow events appended after an initial cursor on one durable address.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - stream cancellation owned by the Remote carrier.
   * @returns a complete opening snapshot followed by gap-free durable events and opted-in assistant frames.
   */
  async *follow(request, signal) {
    validateHistoryWindow(request);
    const { address } = request;
    const target = addressId(address);
    const buffered = new Deque();
    let snapshotCursor;
    let assistantStreamOrdinal = 0;
    let wake;
    const notify = () => {
      const resume = wake;
      wake = void 0;
      resume?.();
    };
    const follower = { closed: false };
    const close = () => {
      follower.closed = true;
      notify();
    };
    this.closeFollowers.add(close);
    const disposeEvent = this.ctx.on("session/event", (session, event) => {
      if (session.id !== target) return;
      buffered.pushBack({ type: "event", event });
      notify();
    }, { global: true });
    const disposeCreated = this.ctx.on("session/created", (session) => {
      if (session.id !== target) return;
      const suffix = session.snapshotEvents(snapshotCursor === void 0 ? session.firstLiveSeq : SessionLogOffset(snapshotCursor + 1));
      for (let index = suffix.length - 1; index >= 0; index -= 1) {
        buffered.pushFront({ type: "event", event: suffix[index] });
      }
      notify();
    }, { global: true });
    const disposeAssistantStream = request.assistantStream !== true ? void 0 : this.ctx.on("agent/assistant-stream", ({ agent, frame }) => {
      if (agent.session.id !== target) return;
      buffered.pushBack({
        type: "assistant-stream",
        frame: wireAssistantStreamFrame(frame, cursorBeforeNext(agent.session.seq)),
        ordinal: ++assistantStreamOrdinal
      });
      notify();
    }, { global: true });
    const onAbort = () => {
      notify();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      var _stack = [];
      try {
        const source = __using(_stack, await this.sourceFor(address, signal, true));
        const events = source.events;
        signal.throwIfAborted();
        const cursor = source.cursor;
        snapshotCursor = cursor;
        const page = paginate(events, void 0, request.maxMessages ?? DEFAULT_MAX_MESSAGES, cursor, request.turnWindow);
        const assistantStream = request.assistantStream === true ? this.assistantStreams.get(target)?.snapshot() ?? { revision: 0 } : void 0;
        const assistantStreamOrdinalCut = assistantStreamOrdinal;
        yield {
          type: "snapshot",
          header: wireHeader(source.header),
          cursor,
          records: pageRecords(page.events),
          hasMore: page.hasMore,
          projections: source.projections === void 0 ? { asOfSeq: cursor, values: {} } : projectionBlock(source.projections),
          ...assistantStream === void 0 ? {} : { assistantStream }
        };
        if (address.kind === "session" && source.source === "prepared") {
          const promotion = source.retain();
          try {
            this.promote(promotion);
          } catch (error) {
            promotion[Symbol.dispose]();
            throw error;
          }
        }
        let nextOffset = SessionLogOffset(cursor + 1);
        while (!follower.closed && !signal.aborted) {
          const item = buffered.popFront();
          if (item === void 0) {
            await new Promise((resolve) => {
              wake = resolve;
            });
            continue;
          }
          if (item.type === "assistant-stream") {
            if (item.ordinal > assistantStreamOrdinalCut) {
              yield { type: "assistant-stream", frame: item.frame };
            }
            continue;
          }
          const expectedSeq = SessionSeq(nextOffset);
          if (item.event.seq < expectedSeq) continue;
          if (item.event.seq !== expectedSeq) {
            throw new RemoteError("gateway/internal", `session event stream skipped seq ${String(expectedSeq)}`, {});
          }
          nextOffset = SessionLogOffset(nextOffset + 1);
          yield entryFor(item.event);
        }
      } catch (_) {
        var _error = _, _hasError = true;
      } finally {
        __callDispose(_stack, _error, _hasError);
      }
    } finally {
      this.closeFollowers.delete(close);
      signal.removeEventListener("abort", onAbort);
      disposeCreated();
      disposeEvent();
      disposeAssistantStream?.();
    }
  }
  async sourceFor(address, signal, withProjections) {
    const sessionId = addressId(address);
    try {
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: withProjections || address.kind === "subagent" ? "all" : "none"
      });
      if (observation.header.cwd === void 0) {
        observation[Symbol.dispose]();
        rejectNotFound(address);
      }
      try {
        validateAddress(
          address,
          observation.header,
          observation.inheritedEventCount,
          observation.projections
        );
      } catch (error) {
        observation[Symbol.dispose]();
        throw error;
      }
      return observation;
    } catch (error) {
      if (error instanceof SessionQueryError && error.code === "SESSION_QUERY_SESSION_NOT_FOUND") rejectNotFound(address);
      throw error;
    }
  }
};
function cursorBeforeNext(nextSeq) {
  return nextSeq === 0 ? -1 : SessionSeq(nextSeq - 1);
}
function wireAssistantStreamFrame(frame, durableCursor) {
  if (frame.type === "start") return { ...frame, startedAfterSeq: durableCursor };
  if (frame.type === "end") return frame;
  return {
    ...frame,
    chunk: frame.chunk
  };
}
function projectionBlock(snapshot) {
  return {
    asOfSeq: snapshot.asOfSeq,
    // Projection definitions validate whole JSON values before snapshot publication.
    values: snapshot.values
  };
}
function validatePageRequest(request) {
  if (!Number.isSafeInteger(request.throughSeq) || request.throughSeq < -1 || Object.is(request.throughSeq, -0)) {
    throw new RemoteError("gateway/bad-request", "throughSeq must be an integer greater than or equal to -1", {});
  }
  if (request.beforeSeq !== void 0 && (!Number.isSafeInteger(request.beforeSeq) || request.beforeSeq < 0 || Object.is(request.beforeSeq, -0))) {
    throw new RemoteError("gateway/bad-request", "beforeSeq must be a non-negative safe integer", {});
  }
  validateHistoryWindow(request);
}
function validateHistoryWindow(request) {
  if (request.maxMessages !== void 0 && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    throw new RemoteError("gateway/bad-request", "maxMessages must be a positive safe integer", {});
  }
  const window = request.turnWindow;
  if (window !== void 0) {
    if (!Number.isSafeInteger(window.minMessages) || window.minMessages <= 0 || window.minMessages > (request.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
      throw new RemoteError("gateway/bad-request", "turnWindow.minMessages must be a positive safe integer no greater than maxMessages", {});
    }
    if (!Number.isSafeInteger(window.minTurns) || window.minTurns <= 0) {
      throw new RemoteError("gateway/bad-request", "turnWindow.minTurns must be a positive safe integer", {});
    }
  }
}
function addressId(address) {
  return address.kind === "session" ? address.sessionId : address.childSessionId;
}
function validateAddress(address, header, inheritedEventCount, projections) {
  if (address.kind === "session") {
    if (header.origin === "subagent") {
      throw new RemoteError("session/agent-busy", "subagent Sessions require their durable parent address", {
        reason: "use subagent delivery for this child session"
      });
    }
    return;
  }
  if (header.origin !== "subagent" || header.parentSession !== address.parentSessionId) {
    throw new RemoteError("subagent/unauthorized", "subagent does not belong to the supplied parent", {
      childSessionId: address.childSessionId
    });
  }
  const identity = projections?.values.subagent;
  if (identity === null) {
    throw new RemoteError("subagent/catalog-diagnostic", "subagent descriptor is corrupt", {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: "corrupt"
    });
  }
  if (identity === void 0 || identity.seq < inheritedEventCount) {
    throw new RemoteError("subagent/catalog-diagnostic", "subagent descriptor is unavailable", {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: "unsupported"
    });
  }
  if (address.mode !== "unknown" && identity.mode !== address.mode) {
    throw new RemoteError("subagent/unauthorized", "subagent mode does not match the supplied address", {
      childSessionId: address.childSessionId
    });
  }
}
function rejectNotFound(address) {
  if (address.kind === "session") {
    throw new RemoteError("session/not-found", `session "${address.sessionId}" not found`, { sessionId: address.sessionId });
  }
  throw new RemoteError("subagent/not-found", "subagent is unavailable", {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId
  });
}
function paginate(events, beforeSeq, maxMessages, throughSeq, turnWindow) {
  const end = SessionLogOffset(Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1));
  let count = 0;
  let turns = 0;
  let cut = SessionLogOffset(0);
  for (let index = end - 1; index >= 0; index--) {
    const event = events[index];
    if (turnWindow !== void 0 && event.type === "turn/start") {
      turns++;
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = SessionLogOffset(index);
        break;
      }
    }
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue;
    count++;
    const sources = event.sourceEventSeqs;
    let groupStart = event.seq;
    if (sources !== void 0) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source;
      }
    }
    if (count >= maxMessages) {
      cut = SessionLogOffset(groupStart);
      break;
    }
  }
  return { events: events.slice(cut, end), hasMore: cut > 0 };
}
function wireHeader(header) {
  return { ...header };
}
function entryFor(event) {
  return {
    type: "event",
    // Session.append validates and freezes event data as JSON before publication.
    event
  };
}
function pageRecords(events) {
  return events.map(entryFor);
}

// vendor/dsh-session-controller/packages/api/session-controller/src/control.ts
var SessionControlController = class {
  /** @param ctx - Host context carrying live Agent and projection services. */
  constructor(ctx) {
    this.ctx = ctx;
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: "projection",
        sessionId: session.id,
        key,
        value,
        seq
      });
    });
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end();
      this.streams.clear();
    }, "session-controller.control");
  }
  streams = /* @__PURE__ */ new Set();
  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal) {
    signal.throwIfAborted();
    const queue = new ControlQueue();
    this.streams.add(queue);
    try {
      yield { type: "baseline", value: this.baseline() };
      yield* queue.iterate(signal);
    } finally {
      this.streams.delete(queue);
      queue.end();
    }
  }
  baseline() {
    const sessions = this.ctx.sessions.list();
    return {
      projections: this.projectionBaseline(sessions)
    };
  }
  projectionBaseline(sessions) {
    const blocks = /* @__PURE__ */ Object.create(null);
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session);
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values
      };
    }
    return blocks;
  }
  broadcast(frame) {
    for (const stream of this.streams) stream.push(frame);
  }
};
var ControlQueue = class {
  buffer = new Deque();
  wake;
  done = false;
  push(frame) {
    if (this.done) return;
    this.buffer.pushBack(frame);
    const wake = this.wake;
    this.wake = void 0;
    wake?.();
  }
  end() {
    if (this.done) return;
    this.done = true;
    const wake = this.wake;
    this.wake = void 0;
    wake?.();
  }
  async *iterate(signal) {
    const onAbort = () => {
      this.end();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront();
        if (frame !== void 0) {
          yield frame;
          continue;
        }
        await new Promise((resolve) => {
          this.wake = resolve;
        });
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront();
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.end();
    }
  }
};

// vendor/dsh-session-controller/packages/api/session-controller/src/list.ts
import { performance } from "node:perf_hooks";
import { scheduler } from "node:timers/promises";
import { SessionQueryError as SessionQueryError2 } from "@deepseek-ai/dsh-session-query";
import { RemoteError as RemoteError2 } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

// vendor/dsh-session-controller/packages/api/session-controller/src/types.ts
var SESSION_SEARCH_RESULT_LIMIT = 20;
var SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240;

// vendor/dsh-session-controller/packages/api/session-controller/src/list.ts
var SEARCH_PROVIDER_CALL_LIMIT = 100;
var SESSION_SEARCH_QUERY_MAX_CHARS = 500;
var MESSAGE_TYPES2 = /* @__PURE__ */ new Set(["user/message", "assistant/message"]);
var sessionListMetadataSchema = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable()
});
var imageLimitsSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImagesPerMessage: z.number().int().positive(),
  maxMessageImageBytes: z.number().int().positive(),
  maxImagePixels: z.number().int().positive(),
  maxImageDimension: z.number().int().positive(),
  mediaTypes: z.array(z.string())
});
function applySessionListMetadata(state, event) {
  const blank = state.blank && event.type !== "turn/start";
  const lastPromptAt = event.type === "user/message" && event.data.source.kind === "user" ? event.time : state.lastPromptAt;
  return blank === state.blank && lastPromptAt === state.lastPromptAt ? state : { blank, lastPromptAt };
}
function truncateUnicodeCodePoints(value, maximum) {
  let count = 0;
  let end = 0;
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end);
    count++;
    end += codePoint.length;
  }
  return value;
}
var ApiSessionList = class {
  /**
   * @param ctx - Host context carrying Session, query, persistence, and projection services.
   * @param workSliceMs - Resolved positive integral list-work budget in milliseconds.
   */
  constructor(ctx, workSliceMs) {
    this.ctx = ctx;
    this.workSliceMs = workSliceMs;
    ctx.sessionProjections.register({
      key: "sessionListMetadata",
      stateSchema: sessionListMetadataSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      wire: { viewSchema: sessionListMetadataSchema, view: (state) => state },
      stateVersion: 1
    });
    ctx.inject(["attachments"], (attachmentCtx) => {
      ctx.sessionProjections.register({
        key: "imageLimits",
        stateSchema: z.null(),
        init: () => null,
        apply: (state) => state,
        wire: {
          viewSchema: imageLimitsSchema,
          view: () => attachmentCtx.attachments.imageLimits
        },
        stateVersion: 1
      });
    });
  }
  /**
   * Build one current attached-Session summary.
   * @param session - attached Session to summarize.
   * @returns current list metadata and available projections.
   */
  summaryFor(session) {
    const projections = this.projectionsFor(session.header, session);
    const metadata = projections?.values.sessionListMetadata;
    return {
      sessionId: session.id,
      updatedAt: updatedAt(session.header, metadata),
      agentAvailable: this.ctx.agents.get(session.id)?.session === session,
      running: this.ctx.agents.get(session.id)?.status === "running",
      blank: metadata?.blank ?? session.seq === 0,
      ...listFields(session.header),
      ...projections === void 0 ? {} : { projections }
    };
  }
  /**
   * Read every visible attached and persisted Session without activating an Agent.
   * @param signal - optional cancellation for persistence reads and summary generation.
   * @returns visible Session summaries ordered by activity.
   */
  async list(signal) {
    signal?.throwIfAborted();
    const records = await this.ctx.sessionQuery.listSessions(signal);
    signal?.throwIfAborted();
    const items = [];
    const cold = [];
    let yieldDeadline = performance.now() + this.workSliceMs;
    for (const record of records) {
      signal?.throwIfAborted();
      const live = this.ctx.sessions.get(record.header.id);
      if (live !== void 0) {
        items.push(this.summaryFor(live));
      } else if (record.header.cwd !== void 0) {
        cold.push(record.header);
      }
      if (performance.now() >= yieldDeadline) {
        await scheduler.yield();
        signal?.throwIfAborted();
        yieldDeadline = performance.now() + this.workSliceMs;
      }
    }
    for (const header of cold) {
      signal?.throwIfAborted();
      items.push(this.summarizeCold(header));
      if (performance.now() >= yieldDeadline) {
        await scheduler.yield();
        signal?.throwIfAborted();
        yieldDeadline = performance.now() + this.workSliceMs;
      }
    }
    signal?.throwIfAborted();
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    return items;
  }
  summarizeCold(header) {
    const projections = this.projectionsFor(header, void 0);
    const metadata = projections?.values.sessionListMetadata;
    return {
      sessionId: header.id,
      updatedAt: updatedAt(header, metadata),
      agentAvailable: false,
      running: false,
      // A large, metadata-less, or inaccessible cache miss remains unknown and visible.
      blank: metadata?.blank ?? false,
      ...listFields(header),
      ...projections === void 0 ? {} : { projections }
    };
  }
  /**
   * Search current visible message content without activating any matching Session.
   * @param query - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  async search(query, signal) {
    const normalizedQuery = normalizeSearchQuery(query);
    signal.throwIfAborted();
    const provider = this.ctx.get("sessionQuery");
    if (provider === void 0) {
      throw new RemoteError2(
        "gateway/internal",
        "session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query",
        {}
      );
    }
    try {
      const visible = await provider.listSessions(signal);
      signal.throwIfAborted();
      const visibleIds = new Set(visible.filter((record) => record.header.cwd !== void 0).map((record) => record.header.id));
      if (visibleIds.size === 0) return { items: [], hasMore: false };
      const authorized = [];
      const acceptedIds = /* @__PURE__ */ new Set();
      const seenCursors = /* @__PURE__ */ new Set();
      let cursor;
      let providerCalls = 0;
      let pageLimit = SESSION_SEARCH_RESULT_LIMIT;
      while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
        signal.throwIfAborted();
        if (providerCalls >= SEARCH_PROVIDER_CALL_LIMIT) {
          throw new Error(`session search provider exceeded the ${SEARCH_PROVIDER_CALL_LIMIT}-call work budget`);
        }
        providerCalls++;
        const requestedCursor = cursor;
        const requestedLimit = pageLimit;
        let page;
        try {
          page = await provider.searchSessions({
            query: normalizedQuery,
            eventFilters: [
              { kind: "type", values: ["user/message", "assistant/message"] },
              { kind: "surface", values: ["current"] }
            ],
            limit: requestedLimit,
            ...requestedCursor === void 0 ? {} : { cursor: requestedCursor }
          }, { signal });
          signal.throwIfAborted();
        } catch (error) {
          signal.throwIfAborted();
          if (requestedCursor === void 0 && error instanceof SessionQueryError2 && error.code === "SESSION_QUERY_INVALID_LIMIT" && requestedLimit > 1) {
            pageLimit = Math.max(1, Math.floor(requestedLimit / 2));
            continue;
          }
          if (requestedCursor !== void 0 && error instanceof SessionQueryError2 && error.code === "SESSION_QUERY_STALE_CURSOR") {
            authorized.length = 0;
            acceptedIds.clear();
            seenCursors.clear();
            cursor = void 0;
            continue;
          }
          throw error;
        }
        if (page.items.length > requestedLimit) {
          throw new Error(`session search provider returned ${String(page.items.length)} items; maximum is ${String(requestedLimit)}`);
        }
        for (const hit of page.items) {
          if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue;
          if (!visibleIds.has(hit.header.id) || hit.bestMatch.sessionId !== hit.header.id || hit.bestMatch.surface !== "current" || !MESSAGE_TYPES2.has(hit.bestMatch.type) || acceptedIds.has(hit.header.id)) continue;
          acceptedIds.add(hit.header.id);
          authorized.push({
            sessionId: hit.header.id,
            snippet: truncateUnicodeCodePoints(hit.bestMatch.snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS)
          });
        }
        if (page.nextCursor !== void 0) {
          if (seenCursors.has(page.nextCursor)) {
            throw new Error("session search provider repeated a continuation cursor");
          }
          seenCursors.add(page.nextCursor);
        }
        if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || page.nextCursor === void 0) break;
        cursor = page.nextCursor;
      }
      return {
        items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
        hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT
      };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof SessionQueryError2 && error.code === "SESSION_QUERY_ABORTED") {
        throw new RemoteError2("gateway/cancelled", "session search was aborted", {});
      }
      throw new RemoteError2("gateway/internal", `session search failed: ${String(error)}`, {});
    }
  }
  projectionsFor(header, session) {
    try {
      if (session !== void 0) {
        return hintsOf("sequenced", this.ctx.sessionProjections.cachedSnapshot(session));
      }
      const cache = this.ctx.get("sessionProjectionCache");
      return hintsOf("cached", cache?.cachedSnapshot(header) ?? cache?.cachedPredecessorTitle(header));
    } catch (error) {
      this.ctx.logger.warn(
        `api-session.list: projection column for "${header.id}" failed; serving the row without it: ${String(error)}`
      );
      return void 0;
    }
  }
};
function hintsOf(kind, block) {
  if (block === void 0 || Object.keys(block.values).length === 0) return void 0;
  return { kind, asOfSeq: block.asOfSeq, values: block.values };
}
function normalizeSearchQuery(query) {
  const normalized = query.trim();
  if (normalized.length === 0) {
    throw new RemoteError2("gateway/bad-request", "session search query must not be empty", {});
  }
  if (normalized.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
    throw new RemoteError2(
      "gateway/bad-request",
      `session search query must contain at most ${SESSION_SEARCH_QUERY_MAX_CHARS} UTF-16 code units`,
      {}
    );
  }
  if (normalized.includes("\0")) {
    throw new RemoteError2("gateway/bad-request", "session search query must not contain NUL", {});
  }
  return normalized;
}
function updatedAt(header, metadata) {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);
}
function listFields(header) {
  return {
    ...header.parentSession === void 0 ? {} : { parentSessionId: header.parentSession },
    ...header.origin === void 0 ? {} : { origin: header.origin },
    ...header.cwd === void 0 ? {} : { cwd: header.cwd }
  };
}

// vendor/dsh-session-controller/packages/subagent/subagent/src/catalog.ts
import { z as z3 } from "zod";

// node_modules/@deepseek-ai/dsh-chunked-list/lib/index.js
import { z as z2 } from "zod";
var CHUNK_CAPACITY = 64;
function appendChunkedList(head, value) {
  if (head === void 0 || head.values.length === CHUNK_CAPACITY) return {
    values: [value],
    ...head === void 0 ? {} : { previous: head }
  };
  return {
    values: [...head.values, value],
    ...head.previous === void 0 ? {} : { previous: head.previous }
  };
}
function* iterateChunkedList(head) {
  const chunks = [];
  for (let chunk = head; chunk !== void 0; chunk = chunk.previous) chunks.push(chunk);
  for (const chunk of chunks.reverse()) yield* chunk.values;
}
function chunkedListSchema(valueSchema) {
  const schema = z2.lazy(() => z2.object({
    values: z2.array(valueSchema).min(1).max(CHUNK_CAPACITY),
    previous: schema.optional()
  }).strict());
  return schema;
}

// vendor/dsh-session-controller/packages/subagent/subagent/src/catalog.ts
var sessionIdSchema = z3.string();
var oneShotCatalogSchema = z3.object({
  version: z3.union([z3.literal(0), z3.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z3.number().int().nonnegative(),
  mode: z3.literal("one-shot"),
  label: z3.string().optional()
}).strict();
var continuableCatalogSchema = z3.object({
  version: z3.union([z3.literal(0), z3.literal(1)]),
  childId: sessionIdSchema,
  childCreatedAt: z3.number().int().nonnegative(),
  mode: z3.literal("continuable"),
  label: z3.string()
}).strict();
var unknownCatalogSchema = oneShotCatalogSchema.extend({ version: z3.literal(1), mode: z3.literal("unknown") });
var eventDataSchema = z3.union([
  oneShotCatalogSchema,
  continuableCatalogSchema,
  unknownCatalogSchema
]);
var viewSchema = z3.array(z3.union([
  oneShotCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: oneShotCatalogSchema.shape.childCreatedAt
  }),
  continuableCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: continuableCatalogSchema.shape.childCreatedAt
  }),
  unknownCatalogSchema.omit({ version: true, childId: true, childCreatedAt: true }).extend({
    id: sessionIdSchema,
    createdAt: unknownCatalogSchema.shape.childCreatedAt
  })
]));
var stateSchema = z3.object({
  inheritedEventCount: z3.number().int().nonnegative(),
  head: chunkedListSchema(eventDataSchema).optional()
}).strict();
function subagentCatalogEntries(state) {
  const entries = [];
  for (const data of iterateChunkedList(state.head)) {
    entries.push(data.mode !== "continuable" ? {
      id: data.childId,
      createdAt: data.childCreatedAt,
      mode: data.mode,
      ...data.label === void 0 ? {} : { label: data.label }
    } : {
      id: data.childId,
      createdAt: data.childCreatedAt,
      mode: data.mode,
      label: data.label
    });
  }
  return entries;
}
var subagentCatalogProjectionDefinition = {
  key: "subagentCatalog",
  stateSchema,
  init: (_header, inheritedEventCount) => ({ inheritedEventCount }),
  apply: (state, event) => {
    if (event.type !== "subagent/catalog" || event.seq < state.inheritedEventCount) return state;
    return { ...state, head: appendChunkedList(state.head, eventDataSchema.parse(event.data)) };
  },
  stateVersion: 3,
  wire: { viewSchema, view: subagentCatalogEntries }
};

// vendor/dsh-session-controller/packages/subagent/subagent/src/projection.ts
import { z as z4 } from "zod";
import { SessionSeq as SessionSeq2 } from "@deepseek-ai/dsh-session";

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
  readString(entry, read, limit, materialize) {
    const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
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
      } else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
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

// vendor/dsh-session-controller/packages/subagent/subagent/src/descriptor.ts
var SUBAGENT_DESCRIPTOR_VERSION = 3;
var DESCRIPTOR_BASE_KEYS = [
  "version",
  "mode",
  "provider",
  "label"
];
var ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS);
var CONTINUABLE_DESCRIPTOR_KEYS = /* @__PURE__ */ new Set([
  ...DESCRIPTOR_BASE_KEYS,
  "agentProvider",
  "agentModel",
  "agentReasoningEffort",
  "persona",
  "toolFilter"
]);
var TOOL_FILTER_KEYS = /* @__PURE__ */ new Set(["allow", "deny"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertKnownKeys(value, keys, path) {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== void 0) {
    throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`);
  }
}
function optionalString(value, key) {
  if (!Object.hasOwn(value, key)) return void 0;
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`persisted subagent descriptor ${key} must be a string`);
  }
  return field;
}
function optionalStringArray(value, key) {
  if (!Object.hasOwn(value, key)) return void 0;
  const field = value[key];
  if (!Array.isArray(field)) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
  }
  const items = field;
  if (items.some((item) => typeof item !== "string")) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`);
  }
  return items;
}
function parseToolFilter(value) {
  if (!isRecord(value)) {
    throw new Error("persisted subagent descriptor toolFilter must be an object");
  }
  assertKnownKeys(value, TOOL_FILTER_KEYS, "toolFilter");
  const allow = optionalStringArray(value, "allow");
  const deny = optionalStringArray(value, "deny");
  if (allow === void 0 && deny === void 0) {
    throw new Error("persisted subagent descriptor toolFilter must declare allow and/or deny");
  }
  return {
    ...allow !== void 0 ? { allow } : {},
    ...deny !== void 0 ? { deny } : {}
  };
}
function parseSubagentDescriptor(value) {
  if (!isRecord(value)) {
    throw new Error("persisted subagent descriptor payload must be an object");
  }
  const version = value["version"];
  if (typeof version !== "number") {
    throw new Error("persisted subagent descriptor version must be a number");
  }
  if (version !== SUBAGENT_DESCRIPTOR_VERSION) return void 0;
  const mode = value["mode"];
  if (mode !== "one-shot" && mode !== "continuable") {
    throw new Error('persisted subagent descriptor mode must be "one-shot" or "continuable"');
  }
  assertKnownKeys(
    value,
    mode === "one-shot" ? ONE_SHOT_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS,
    "payload"
  );
  const provider = value["provider"];
  if (typeof provider !== "string") {
    throw new Error("persisted subagent descriptor provider must be a string");
  }
  if (mode === "one-shot") {
    const label2 = optionalString(value, "label");
    return {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode,
      provider,
      ...label2 !== void 0 ? { label: label2 } : {}
    };
  }
  const label = value["label"];
  if (typeof label !== "string") {
    throw new Error("persisted subagent descriptor label must be a string");
  }
  const agentProvider = optionalString(value, "agentProvider");
  const agentModel = optionalString(value, "agentModel");
  const agentReasoningEffort = optionalString(value, "agentReasoningEffort");
  const persona = optionalString(value, "persona");
  const toolFilter = Object.hasOwn(value, "toolFilter") ? parseToolFilter(value["toolFilter"]) : void 0;
  return {
    version: SUBAGENT_DESCRIPTOR_VERSION,
    mode,
    provider,
    label,
    ...agentProvider !== void 0 ? { agentProvider } : {},
    ...agentModel !== void 0 ? { agentModel } : {},
    ...agentReasoningEffort !== void 0 ? { agentReasoningEffort } : {},
    ...persona !== void 0 ? { persona } : {},
    ...toolFilter !== void 0 ? { toolFilter } : {}
  };
}
function foldSubagentDescriptor(events) {
  const event = events.find(
    (candidate) => candidate.type === "subagent/descriptor"
  );
  if (event === void 0) return void 0;
  return parseSubagentDescriptor(event.data);
}

// vendor/dsh-session-controller/packages/subagent/subagent/src/projection.ts
var activeIntervalSchema = z4.object({
  since: z4.number().int().nonnegative(),
  through: z4.number().int().nonnegative()
}).strict();
var projectionSchema = z4.object({
  settledMs: z4.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
  lastTurnCompleted: z4.boolean().optional()
}).strict().transform(({ settledMs, active, lastTurnCompleted }) => ({
  settledMs,
  ...active === void 0 ? {} : { active },
  ...lastTurnCompleted === void 0 ? {} : { lastTurnCompleted }
}));
var timingStateSchema = z4.object({
  settledMs: z4.number().int().nonnegative(),
  active: activeIntervalSchema.optional(),
  pendingTurnStart: z4.number().int().nonnegative().optional(),
  descriptorSeen: z4.boolean(),
  lastTurnCompleted: z4.boolean().optional()
}).strict();
var identityValueSchema = z4.discriminatedUnion("mode", [
  z4.object({
    mode: z4.literal("one-shot"),
    label: z4.string().optional(),
    seq: z4.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq2)
  }).strict(),
  z4.object({
    mode: z4.literal("continuable"),
    label: z4.string(),
    seq: z4.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq2)
  }).strict()
]);
var identitySchema = identityValueSchema.nullable();
var identityStateSchema = z4.object({
  identity: identityValueSchema.optional()
}).strict();
function descriptorIdentity(event) {
  let descriptor;
  try {
    descriptor = foldSubagentDescriptor([event]);
  } catch {
    descriptor = void 0;
  }
  if (descriptor === void 0) return void 0;
  return descriptor.mode === "one-shot" ? {
    mode: "one-shot",
    ...descriptor.label !== void 0 ? { label: descriptor.label } : {},
    seq: event.seq
  } : { mode: "continuable", label: descriptor.label, seq: event.seq };
}
var subagentIdentityProjectionDefinition = {
  key: "subagent",
  stateSchema: identityStateSchema,
  init: () => ({}),
  apply: (state, event) => {
    if (event.type !== "subagent/descriptor") return state;
    const identity = descriptorIdentity(event);
    return identity === void 0 ? {} : { identity };
  },
  wire: { viewSchema: identitySchema, view: (state) => state.identity ?? null },
  // Bumped when the identity gained its `seq` field: an older checkpoint row
  // would replay into a value the schema rejects, so it must refold instead.
  stateVersion: 2
};

// <stdin>
import { foldSubagentDescriptor as foldSubagentDescriptor2 } from "@deepseek-ai/dsh-subagent";
function latestCompletedPrefixBoundary(events) {
  const lastTurnEnd = events.findLast((event) => event.type === "turn/end");
  if (lastTurnEnd === void 0) return void 0;
  let boundary = lastTurnEnd.seq;
  for (const next of events.slice(boundary + 1)) {
    if (next.type === "turn/start" || next.type === "user/message" && next.surfaceOp === "append" || next.type === "agent/inbox/spliced") break;
    boundary = next.seq;
  }
  return boundary;
}
export {
  ApiSessionList,
  SessionControlController,
  SessionHistoryController,
  foldSubagentDescriptor2 as foldSubagentDescriptor,
  latestCompletedPrefixBoundary,
  subagentCatalogProjectionDefinition,
  subagentIdentityProjectionDefinition
};
