# Windows CI 上 workspace-write 未拒绝越界写入（待沙箱作者确认）

日期：2026-10-18。代码版本：`4c33385`（tag v0.3.0 曾指向此）。CI run `39117253871`。

## 现象

`tests/approval-architecture.test.mjs:67`「实际进程的动态写入受保护：工作区内成功，工作区外失败，单次扩大权限不延续」在 Windows CI 失败：

```
test at tests\approval-architecture.test.mjs:67:1
AssertionError: true !== false
  at tests/approval-architecture.test.mjs:77:10   # assert.equal((await workspace.runCommand(command)).ok, false)
```

即：默认 `workspace-write` 模式下，向工作区上级目录写入 `outside.txt` 的命令 **返回 ok=true（写入成功）**，预期是被拒绝（ok=false）。macOS / Linux 上同一测试通过。

该测试的工作区在 `process.cwd()` 下（`D:\a\dyworker\dyworker\.dyw-approval-test-*\work`），目标文件在其父目录。命令是跨平台的
`node -e "require('fs').writeFileSync(require('path').join('..','out'+'side.txt'),'changed')"`。

## 与测试命令无关

本条不是测试写法问题（上一轮确实有一批 POSIX 命令写法问题，已由 4c33385 修复，本轮「实际执行日志前四步」「长任务实际连续完成」已转绿）。本条是 confinement 语义问题：

- `dsh-sandbox-windows-acl` 的 README 写明 workspace-write 下「受 ACL 管辖的其他写入与删除都会被拒绝」（Low 完整性降级令牌 + write SID 白名单）。
- 但实际运行中越界写入成功，说明 runner 没有真正约束住这次写入，或降级后裸跑。

## 需要确认的两个方向

1. **windows-acl 在该环境是否降级运行而未失败关闭。**
   `confine()` 的返回含 `enforcement`、`denialSignatures`、`runnerFailureRules`，runner 设计上每次运行都在 stderr 打 `windows-acl-run: <detail>` 自报状态。
   但 `electron/agent.mts` 的 `Workspace.runCommand`（约 720-726 行）只取 `confined.argv`，完全忽略这三个字段——runner 若降级（自报 fatal signature），命令照样执行且结果被当成普通成功。
   建议：runCommand 应按 denialSignatures / runnerFailureRules 检查 stderr，命中即判失败并向用户如实报告「保护降级」；enforcement 为 partial 时是否允许执行也应有明确策略。

2. **越界写入为何能通过 ACL。**
   一个待验证的假设：runner 的 restricting 列表携带 Everyone/登录 SID 作为保活组（README 写明两组都在），而 GitHub Actions 的 `D:\a` 对 Everyone 开放写权限——pass-2 只核对 restricting 列表携带的内容，于是工作区外写入被放行。需要在真实 Windows 上验证：Low 令牌 + Everyone 可写目录下，写 workspace 外文件是否被拒。
   若确认，需决定：修后端（write pass-2 排除 Everyone 携带的权限），或在文档中明确这一边界。

## 当时的另三项失败（已按测试侧修复，见同目录提交）

- `approval-followup:105` ENOENT checked.txt：fixture 未 realpath，os.tmpdir() 的 8.3 短路径与按长路径建立的授权不匹配。已改为 realpath。
- `approval-task-continuity:165` 标记文件未生成：多行命令里 POSIX heredoc 在前，cmd 解析失败后标记行未执行。已改为 Windows 上标记行置前。
- `command-attachments:34` ENOTEMPTY rmdir：Windows 句柄释放延迟的清理抖动。已为临时目录 rm 加 maxRetries。

## 复现方式

GitHub Actions windows-latest runner，`npm run verify`，run 39117253871 的 Windows job 日志。
本机 macOS 无法复现（seatbelt 正常拒绝）。
