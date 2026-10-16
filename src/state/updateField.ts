export type Updater<T> = T | ((previous: T) => T);

// 保留 useState 的同值跳过语义。Zustand 只比较整份状态的引用，
// 返回新的部分对象（即便字段值没变）仍会通知整页订阅者。
export function updateField<State, Key extends keyof State>(
  state: State,
  key: Key,
  value: Updater<State[Key]>,
): State | Pick<State, Key> {
  const previous = state[key];
  const next = typeof value === "function"
    ? (value as (previous: State[Key]) => State[Key])(previous)
    : value;
  return Object.is(previous, next) ? state : { [key]: next } as Pick<State, Key>;
}
