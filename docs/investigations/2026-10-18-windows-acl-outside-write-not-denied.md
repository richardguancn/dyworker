# Windows CI 上 workspace-write 未拒绝越界写入

日期：2026-10-18。代码版本：`4c33385`（tag v0.3.0 曾指向此）。CI run `39117253871`。

## 后续处理：临时阻止，不代表 Windows 正常执行已修复

本次以 `5da7ef0` 为代码基线核对。新增启动前检查、前台和后台结果检查；当前固定版本的 Windows 后端仅声明 `partial`，且已有真实越界写入记录，因此 **Windows 的默认受限命令暂时在启动前停止**。同样影响默认后台命令，以及经这些入口执行命令的 DSH/机器人。它不是可正常发布的 Windows 功能恢复：原有要求工作区内命令成功的测试仍保留，没有更改为接受失败，也没有跳过 Windows 安全断言。

阻止发生在调用 `confine()` 之前，避免先物化常驻 ACL/Low 标签再拒绝。其他平台若返回 `partial`、未知保护程度或缺失诊断依据，也停止启动。已有明确单次完全访问/用户完全访问的能力保留；不会因保护不足自动选择该模式。

前台与后台现在分别收集 `denialSignatures` 和 `runnerFailureRules` 的依据，遵守非零退出码、逐规则退出码门槛、普通提示整行排除和后端自己的签名。普通命令错误、实际文件拒绝和保护程序故障有不同结果；诊断依据独立于显示日志保留，输出截断不会抹去早期故障。成功命令仅打印同名文本或清理提示不被误报为启动失败。该分类只能描述已发生的结果，不能在文件已被越界修改后撤销影响，真正的当前阻止措施是启动前拒绝不完整保护。

DSH 程序执行器另有 Node 文件访问限制，仍沿用原有独立检查；本次没有把 Windows ACL 的部分能力升级为完整保护，也没有宣称所有平台的所有进程入口均完成实机验收。

## 核对后需要纠正的两点

1. `enforcement: 'partial'` 是后端固有能力声明，不是一次运行中临时裸跑的通知。本机固定依赖的 `runner.js` 在初始化/启动失败时打印 `windows-acl-run: ...` 并以 **127** 退出，子程序不会通过该错误分支被不受限启动。它也不是每次运行都会打印状态；正常成功时可以没有该行。清理失败打印同名前缀，但保留子程序退出码，不能仅凭前缀认定命令根本没运行。
2. 忽略上述字段确实是本应用的处理缺口；但单纯漏做退出后分类，不能解释这次返回 0 且文件改变的结果。因此，不能把补上分类当成修复 ACL 越界写入的证据。

## 真实 Windows 待验证内容

保留 Everyone/登录 SID 与 `D:\a` 权限的假设，同时必须检查对象的完整性标签。本机安装包的 README 和代码说明：令牌会降为 Low，工作区目录获得常驻、可继承的 Low 标签；较早以更大目录为工作区的执行也可能影响之后的嵌套工作区。因此“父目录曾获授权后留下的标签/权限”是另一个需要对照的变量，当前没有 Windows 观察结果，不能写成已确认原因。

已新增专用脚本：

```powershell
node scripts/diagnose-windows-command-protection.mjs > windows-command-protection.json
```

脚本只在仓库内自建 `.dyw-windows-acl-probe-*` 目录，直接调用官方后端，分别检查首次授权及父目录曾获授权后的工作区内/外写入、只读模式写入。记录 `icacls`、后端声明、退出码、原始输出和独立读回的文件变化；最终清理夹具。不改仓库根目录权限，不读取业务文件。它是独立诊断程序，不是应用遇到保护不足时的自动替代路径。

退出 0 表示这几个夹具未复现；1 表示观察到工作区外或只读模式的真实写入；2 表示诊断不完整或环境不适用。即使返回 0，也不能证明任意 Windows 路径均受保护，更不能据此自动撤掉临时阻止措施。

当前没有连接的 Windows 主机。尝试读取上述 GitHub CI 原始日志时，执行工具的自动审批服务因用量已达上限拒绝执行，操作未运行。尚未触发新 CI、推送代码、修改依赖或发布应用。

## 本次验证范围

- 新增 `tests/command-protection.test.mjs`：16 项通过、0 失败、0 跳过。与官方诊断约定对照；独立测试进程替换提供者元信息，实际调用前台/后台入口并检查启动标记。验证 `partial` 不启动、错误分类、大小写、分段输出、CRLF、超长输出及正常执行；诊断脚本的本地模拟分别观察到自建夹具越界写入及启动失败，正确报告并清理目录。这不是 Windows ACL 实机测试。
- `npm run build:electron` 通过；未修改页面。
- 不依赖本机内核隔离能力的新增检查、宿主和现有权限检查合计 47 项通过、0 失败、0 跳过。
- 在本机外层受限环境运行相关回归，原有真实执行保护测试在首项“工作区内写入应成功”处失败；这是本机 `sandbox_apply` 限制造成的执行不可用，不能与 Windows 的“工作区外写入成功”混为一谈。没有把此项记为通过。
- Windows 正常受限执行尚未恢复；原有跨平台执行验收仍必须在真实目标系统完成，不能据本机结果发布 Windows 修复。

本地检查输出保存在 [`docs/verification/windows-command-protection-2026-10-18/`](../verification/windows-command-protection-2026-10-18/)。

以下保留首次诊断的现象与待确认方向；其中关于“降级裸跑”的表述应以上述核对结果为准。

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
