// 会话消息队列：同一会话内串行执行，排队中的消息允许编辑或取消。
// 队列只保存运行所需的快照（runId、payload、事件发送者），消息内容本身
// 以渲染端保存的会话存档为准，开始执行时再按 runId 取最新内容。
export class SessionQueue {
  constructor() {
    /** @type {Map<string, Array<{ sessionId: string; runId: string; payload: object; sender: object }>>} */
    this.queues = new Map();
  }

  count(sessionId) {
    return (this.queues.get(String(sessionId)) || []).length;
  }

  total() {
    let total = 0;
    for (const list of this.queues.values()) total += list.length;
    return total;
  }

  has(sessionId) {
    return this.count(sessionId) > 0;
  }

  push(entry) {
    const sessionId = String(entry?.sessionId || "");
    if (!sessionId || !entry?.runId) return 0;
    const list = this.queues.get(sessionId) || [];
    list.push({ sessionId, runId: String(entry.runId), payload: entry.payload, sender: entry.sender });
    this.queues.set(sessionId, list);
    return list.length;
  }

  peek(sessionId) {
    const list = this.queues.get(String(sessionId));
    return list?.length ? list[0] : null;
  }

  shift(sessionId) {
    const list = this.queues.get(String(sessionId));
    if (!list?.length) return null;
    const entry = list.shift();
    if (!list.length) this.queues.delete(String(sessionId));
    return entry;
  }

  remove(sessionId, runId) {
    const sessionIdKey = String(sessionId);
    const list = this.queues.get(sessionIdKey);
    if (!list?.length) return false;
    const next = list.filter((entry) => String(entry.runId) !== String(runId));
    if (next.length === list.length) return false;
    if (next.length) this.queues.set(sessionIdKey, next);
    else this.queues.delete(sessionIdKey);
    return true;
  }

  clear() {
    this.queues.clear();
  }
}
