// 活动（工具调用）记录相关的纯函数：标题改写、子代理分支挂载、状态回填。
// 原先内联在 App.tsx，过程时间线与 agent 事件归约共用。
import type { ActivityRecord } from "../types";

export function activityDisplayTitle(activity: ActivityRecord) {
  if (activity.kind !== "run_command") return activity.title;
  const command = activity.title.replace(/^运行命令[：:]\s*/, "");
  if (/^(已运行|正在运行|运行失败)\s/.test(activity.title)) return activity.title;
  if (activity.status === "running") return `正在运行 ${command}`;
  if (activity.status === "error") return `运行失败 ${command}`;
  return `已运行 ${command}`;
}

// 子代理分支活动挂载：把带 branch 的活动追加到父活动（dispatch_agent）的 children 上，
// 成为 message.activities 的一部分（随 sessions.json 落盘，天然按消息归属，不会跨会话串数据）。
// 找不到父活动（极端时序）时返回 attached: false，由调用方丢弃，不混进主活动流。
export function appendBranchActivity(list: ActivityRecord[], activity: ActivityRecord): { list: ActivityRecord[]; attached: boolean } {
  const parentId = activity.branch?.parentId;
  if (!parentId) return { list, attached: false };
  let attached = false;
  const next = list.map((parent) => {
    if (parent.id !== parentId) return parent;
    attached = true;
    return { ...parent, children: [...(parent.children || []), activity] };
  });
  return { list: next, attached };
}

export function patchActivityTree(list: ActivityRecord[], id: string, status: ActivityRecord["status"], detail: string | undefined, durationMs?: number, commentary?: string): ActivityRecord[] {
  return list.map((activity) => {
    if (activity.id === id) {
      return {
        ...activity,
        status,
        detail: detail ?? activity.detail,
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(commentary !== undefined ? { commentary } : {}),
      };
    }
    if (activity.children?.some((child) => child.id === id)) {
      return {
        ...activity,
        children: (activity.children || []).map((child) =>
          child.id === id ? { ...child, status, detail: detail ?? child.detail, ...(durationMs !== undefined ? { durationMs } : {}), ...(commentary !== undefined ? { commentary } : {}) } : child),
      };
    }
    return activity;
  });
}
