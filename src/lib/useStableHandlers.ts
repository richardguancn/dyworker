import { useLayoutEffect,useMemo,useRef } from "react";


// 回调始终读取最新的会话与设置，消息行的展示数据则全部通过 props 明确传入。
export function useStableHandlers<T extends Record<string, (...args: any[]) => any>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  return useMemo(() => Object.fromEntries(Object.keys(handlers).map(key => [key,
    (...args: any[]) => latest.current[key](...args),
  ])) as T, []);
}
