import assert from "node:assert/strict";
import test from "node:test";
import { SessionQueue } from "../electron/session-queue.mjs";

test("SessionQueue 按会话串行保存队列项", () => {
  const queue = new SessionQueue();
  assert.equal(queue.push({ sessionId: "s1", runId: "r1", payload: { a: 1 }, sender: {} }), 1);
  assert.equal(queue.push({ sessionId: "s1", runId: "r2", payload: { a: 2 }, sender: {} }), 2);
  assert.equal(queue.push({ sessionId: "s2", runId: "r3", payload: {}, sender: {} }), 1);
  assert.equal(queue.count("s1"), 2);
  assert.equal(queue.total(), 3);
  assert.equal(queue.peek("s1").runId, "r1");
  assert.equal(queue.shift("s1").runId, "r1");
  assert.equal(queue.count("s1"), 1);
  assert.equal(queue.shift("s1").runId, "r2");
  assert.equal(queue.has("s1"), false);
  assert.equal(queue.count("s2"), 1);
});

test("SessionQueue 支持移除排队项并保持顺序", () => {
  const queue = new SessionQueue();
  queue.push({ sessionId: "s1", runId: "r1", payload: {}, sender: {} });
  queue.push({ sessionId: "s1", runId: "r2", payload: {}, sender: {} });
  queue.push({ sessionId: "s1", runId: "r3", payload: {}, sender: {} });
  assert.equal(queue.remove("s1", "r2"), true);
  assert.equal(queue.count("s1"), 2);
  assert.equal(queue.peek("s1").runId, "r1");
  assert.equal(queue.shift("s1").runId, "r1");
  assert.equal(queue.shift("s1").runId, "r3");
  assert.equal(queue.remove("s1", "r9"), false);
});

test("SessionQueue 支持把排队项提到队首（立即执行）", () => {
  const queue = new SessionQueue();
  queue.push({ sessionId: "s1", runId: "r1", payload: {}, sender: {} });
  queue.push({ sessionId: "s1", runId: "r2", payload: {}, sender: {} });
  queue.push({ sessionId: "s1", runId: "r3", payload: {}, sender: {} });
  // 中间的项提到队首，其余相对顺序不变
  assert.equal(queue.promote("s1", "r3"), true);
  assert.equal(queue.peek("s1").runId, "r3");
  assert.equal(queue.shift("s1").runId, "r3");
  assert.equal(queue.shift("s1").runId, "r1");
  assert.equal(queue.shift("s1").runId, "r2");
  // 已在队首的项幂等；不存在的项与空队列安全返回
  queue.push({ sessionId: "s1", runId: "r4", payload: {}, sender: {} });
  assert.equal(queue.promote("s1", "r4"), true);
  assert.equal(queue.peek("s1").runId, "r4");
  assert.equal(queue.promote("s1", "r9"), false);
  assert.equal(queue.promote("s9", "r4"), false);
});

test("SessionQueue 空会话与无效项安全返回", () => {
  const queue = new SessionQueue();
  assert.equal(queue.shift("s1"), null);
  assert.equal(queue.remove("s1", "r1"), false);
  assert.equal(queue.push({ sessionId: "", runId: "r1", payload: {}, sender: {} }), 0);
  assert.equal(queue.push({ sessionId: "s1", runId: "", payload: {}, sender: {} }), 0);
  queue.push({ sessionId: "s1", runId: "r1", payload: {}, sender: {} });
  queue.clear();
  assert.equal(queue.total(), 0);
});
