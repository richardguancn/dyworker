import test from "node:test";
import assert from "node:assert/strict";
import { useSessionStore, selectActiveSession, getComposerWorkspacePath } from "../src/state/sessionStore.ts";
import { appIpcPlugin } from "../electron/host/plugins/app-ipc.mts";

async function readStartupState(sessions, activeSessionId = null) {
  let handler;
  const workspaceReads = [];
  appIpcPlugin({
    trustedHandle: (name, callback) => {
      assert.equal(name, "app:initial-state");
      handler = callback;
    },
    readAllSessions: async () => sessions,
    readJson: async () => [],
    dataFile: name => name,
    listWorkspace: async workspacePath => { workspaceReads.push(workspacePath); return []; },
    readSettings: async () => ({ identity: "general" }),
    getMainWindow: () => null,
  }).apply({ sessions: { getActiveId: async () => activeSessionId } });
  return { state: await handler(), workspaceReads };
}

test("全新安装返回空记录，不创建欢迎对话或虚构项目", async () => {
  const { state, workspaceReads } = await readStartupState([]);
  assert.deepEqual(state.sessions, []);
  assert.equal(state.activeSessionId, null);
  assert.equal(state.workspacePath, "");
  assert.deepEqual(workspaceReads, [""]);
});

test("启动读取保留已有记录及上次选中的对话", async () => {
  const saved = [{ id: "real-task", workspacePath: "/real/project", messages: [{role: "user", content: "已保存的任务"}] }];
  const { state } = await readStartupState(saved, "real-task");
  assert.deepEqual(state.sessions, saved);
  assert.equal(state.activeSessionId, "real-task");
  assert.equal(state.workspacePath, "/real/project");
});

test("启动前不展示示例对话、项目或文件", () => {
  const initial = useSessionStore.getState();
  assert.deepEqual(initial.sessions, []);
  assert.deepEqual(initial.workspaceEntries, []);
  assert.equal(initial.activeId, "");
  assert.equal(initial.composerSessionId, "");
  assert.equal(initial.workspacePath, "");
  assert.equal(initial.newTaskDraft, null);
  assert.equal(selectActiveSession(initial), undefined);
  assert.equal(getComposerWorkspacePath(), "");
});

test("读取记录后恢复选中的对话，无历史记录时展示未发送的新任务", () => {
  const initial = useSessionStore.getState();
  const first = { id: "first", workspacePath: "/real/first", messages: [] };
  const selected = { id: "selected", workspacePath: "/real/selected", messages: [{ role: "user", content: "真实记录" }] };
  try {
    useSessionStore.setState({ sessions: [first, selected], activeId: selected.id });
    assert.equal(selectActiveSession(useSessionStore.getState()), selected);
    assert.equal(getComposerWorkspacePath(), selected.workspacePath);

    const draft = { id: "draft", workspacePath: "", messages: [] };
    useSessionStore.setState({ sessions: [], activeId: draft.id, newTaskDraft: draft });
    assert.equal(selectActiveSession(useSessionStore.getState()), draft);
    assert.deepEqual(useSessionStore.getState().sessions, []);
    assert.equal(getComposerWorkspacePath(), "");
  } finally {
    useSessionStore.setState(initial, true);
  }
});
