// 定时计划的保存 / 启停 / 删除 / 手动触发（模块级 actions）。
//
// 整组函数原样从 App.tsx 搬出，只是把「读写 state 的裸标识符」改成经 store 的
// getState() 解构拿到，并把跨模块共享的 ref 换成 sharedRefs 里的模块级单例；
// 函数体、文案与行为均保持不变，供 App 等任意位置 import 调用。
import type { ScheduleDraft } from "../features/plans/PlansPanel";
import { usePanelStore } from "./panelStore";
import { useSessionStore } from "./sessionStore";
import { useViewStore } from "./viewStore";
import { manualRunScheduleRef } from "./sharedRefs";

export const saveSchedule = async (draft: ScheduleDraft) => {
  const { workspacePath } = useSessionStore.getState();
  const { setSchedules } = usePanelStore.getState();
  const { setError, setNotice } = useViewStore.getState();
  const planWorkspacePath = (draft.workspacePath || "").trim() || workspacePath;
  const result = await window.dyworker?.saveSchedule({ ...draft, workspacePath: planWorkspacePath });
  if (!result?.ok) {
    setError(result?.error || "保存计划失败");
    return false;
  }
  setNotice("定时计划已保存");
  setSchedules(await window.dyworker?.listSchedules() || []);
  return true;
};

export const toggleSchedule = (id: string, enabled: boolean) => {
  const { setSchedules } = usePanelStore.getState();
  setSchedules((current) => current.map((item) => item.id === id ? { ...item, enabled } : item));
  void window.dyworker?.setScheduleEnabled(id, enabled);
};

export const deleteSchedule = (id: string) => {
  const { setSchedules } = usePanelStore.getState();
  setSchedules((current) => current.filter((item) => item.id !== id));
  void window.dyworker?.deleteSchedule(id);
};

export const triggerSchedule = (id: string) => {
  const { setError, setNotice } = useViewStore.getState();
  // 记下这次是手动触发的哪个计划：主进程回 schedules:run-started 时把这次运行的会话
  // 直接打开（用户点了「立即执行」就是要马上看到它在跑）
  manualRunScheduleRef.current = id;
  void window.dyworker?.triggerSchedule(id).then((result) => {
    if (!result?.ok) {
      manualRunScheduleRef.current = "";
      setError(result?.error || "无法执行");
    } else if (result.started === false) {
      // 忙碌守卫把这一轮推迟了（桌面任务在跑或已有后台任务）：明说"已排队"，
      // 别让用户以为点了没反应，也别谎报"已开始执行"
      manualRunScheduleRef.current = "";
      setNotice("当前有任务正在运行，这个计划已排队，等它结束后自动开始");
    } else {
      setNotice("计划已开始执行，正在打开这次运行的会话");
    }
  });
};
