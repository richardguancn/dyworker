/** 有界的可重建缓存；不会删除或改写原始数据。 */
export function createBoundedCache<Value>(maxEntries: number, maxBytes: number, weigh: (value: Value) => number) {
  const entries = new Map<string, { value: Value; bytes: number }>();
  let bytes = 0;
  const remove = (key: string) => {
    const previous = entries.get(key);
    if (!previous) return false;
    bytes -= previous.bytes;
    return entries.delete(key);
  };
  return {
    has: (key: string) => entries.has(key),
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: Value) {
      remove(key);
      const size = weigh(value);
      if (size > maxBytes || maxEntries < 1) return;
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value!);
      entries.set(key, { value, bytes: size }); bytes += size;
    },
    delete: remove,
    keys: () => entries.keys(),
    stats: () => ({ entries: entries.size, bytes, maxEntries, maxBytes }),
  };
}
