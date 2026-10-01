// IPC 域插件：Git 操作（git:*）。
// 领域能力全部来自 electron/git.mts（纯函数，不依赖 electron/cordis），直接 import；
// 只有"生成提交信息"要调模型，属壳层领域（含设置/超时编排），经 deps 注入。
import {
  gitCheckout,
  gitCommit,
  gitCreateBranch,
  gitDiffStats,
  gitDiscard,
  gitFileDiff,
  gitPush,
  gitReviewOverview,
  gitStage,
  listGitBranches,
} from "../../git.mts";

export function gitIpcPlugin(deps) {
  return {
    name: "ipc:git",
    apply(ctx) {
      const { trustedHandle, generateCommitMessage } = deps;

      trustedHandle("git:branches", (_event, workspacePath) => listGitBranches(String(workspacePath || "")));
      trustedHandle("git:diff-stats", (_event, workspacePath) => gitDiffStats(String(workspacePath || "")));
      trustedHandle("git:checkout", (_event, payload) => gitCheckout(String(payload?.workspacePath || ""), String(payload?.branch || "")));
      trustedHandle("git:create-branch", (_event, payload) => gitCreateBranch(String(payload?.workspacePath || ""), String(payload?.branch || "")));
      trustedHandle("git:suggest-commit-message", async (_event, workspacePath) => {
        try {
          const message = await generateCommitMessage(String(workspacePath || ""));
          return { ok: true, message };
        } catch (error: any) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      });
      trustedHandle("git:commit", (_event, payload) => gitCommit(String(payload?.workspacePath || ""), {
        message: String(payload?.message || ""),
        includeUnstaged: payload?.includeUnstaged !== false,
      }));
      trustedHandle("git:push", (_event, workspacePath) => gitPush(String(workspacePath || "")));
      trustedHandle("git:review-overview", (_event, payload) => gitReviewOverview(String(payload?.workspacePath || ""), String(payload?.base || "HEAD")));
      trustedHandle("git:file-diff", (_event, payload) => gitFileDiff(
        String(payload?.workspacePath || ""),
        String(payload?.base || "HEAD"),
        String(payload?.path || ""),
        Boolean(payload?.untracked),
      ));
      trustedHandle("git:stage", (_event, payload) => gitStage(String(payload?.workspacePath || ""), payload?.paths));
      trustedHandle("git:discard", (_event, payload) => gitDiscard(String(payload?.workspacePath || ""), payload?.paths));
    },
  };
}
