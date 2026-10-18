// 工作区维度的占用判定：不同工作区各写各的目录，互不影响；只有同一工作区的两个任务
// 同时跑才可能互相覆盖文件，才需要互斥。
// 渠道消息早前等的是「整机空闲」（任何桌面任务、定时任务、其他渠道任务都算占用），
// 电脑端一有长任务，QQ/微信消息就干等满 10 分钟再被丢弃。这里把判定收敛到工作区，
// 纯函数不依赖 electron，方便 node --test 直接测。

// 只用来比较"是不是同一个目录"：末尾分隔符与首尾空白不影响判定
export function normalizeWorkspacePath(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

/**
 * 找出占着同一工作区的其他任务。
 * @param entries 形如 [{ sessionId, workspacePath, kind }]，即所有正在执行的任务
 * @param workspacePath 待判定的工作区
 * @param ignoreSessionId 需要忽略的会话（判定自己的占用时传自己的 sessionId）
 * @returns 阻塞项数组；空数组表示可以立即执行
 */
export function findWorkspaceBlockers(entries, workspacePath, ignoreSessionId = "") {
  const target = normalizeWorkspacePath(workspacePath);
  // 工作区未知（空串）时不阻塞：调用方随后会按"还没有选择工作区"给出明确报错
  if (!target) return [];
  const blockers = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    const sessionId = String(entry.sessionId ?? "");
    if (ignoreSessionId && sessionId === String(ignoreSessionId)) continue;
    if (normalizeWorkspacePath(entry.workspacePath) !== target) continue;
    blockers.push({ sessionId, kind: String(entry.kind || "任务") });
  }
  return blockers;
}
