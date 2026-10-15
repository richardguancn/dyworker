/** UTF-16 文字预算同时计算 key 与 value；超大单项不常驻，不周期性清空热项。 */
export function createTextCache(maxEntries = 400, maxBytes = 2 * 1024 * 1024) {
  const entries = new Map<string, string>();
  let bytes = 0;
  return {
    get(source: string, compute: (source: string) => string) {
      const hit = entries.get(source);
      if (hit !== undefined) {
        entries.delete(source);
        entries.set(source, hit);
        return hit;
      }
      const value = compute(source);
      const size = (source.length + value.length) * 2;
      if (size > maxBytes) return value;
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) {
        const [key, previous] = entries.entries().next().value!;
        entries.delete(key);
        bytes -= (key.length + previous.length) * 2;
      }
      if (maxEntries > 0) {
        entries.set(source, value);
        bytes += size;
      }
      return value;
    },
    stats: () => ({ entries: entries.size, bytes }),
  };
}

/** 一次线性遍历建轮次索引；不可变消息未变时复用摘要，只重算受影响轮次。 */
export function createConversationIndex<Message extends { role: string }, Preview>(
  previewFor: (user: Message, assistant?: Message) => Preview,
) {
  const previews = new WeakMap<Message, { assistant?: Message; preview: Preview }>();
  return (messages: Message[]) => {
    const turns: Array<{ messageIndex: number; preview: Preview }> = [];
    const byMessageIndex = new Map<number, number>();
    let userIndex = -1;
    let assistant: Message | undefined;
    const finish = () => {
      if (userIndex < 0) return;
      const user = messages[userIndex];
      const cached = previews.get(user);
      const preview = cached && cached.assistant === assistant ? cached.preview : previewFor(user, assistant);
      previews.set(user, { assistant, preview });
      byMessageIndex.set(userIndex, turns.length);
      turns.push({ messageIndex: userIndex, preview });
    };
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role === "user") {
        finish();
        userIndex = index;
        assistant = undefined;
      } else if (userIndex >= 0 && !assistant && message.role === "assistant") assistant = message;
    }
    finish();
    return { turns, byMessageIndex };
  };
}
