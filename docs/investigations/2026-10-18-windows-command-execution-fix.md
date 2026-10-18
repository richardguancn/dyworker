# Windows 命令假成功：真实 CI 对照与修复

日期：2026-10-18。起始代码：`5da7ef0`。工作分支：`codex/windows-command-protection`。

## 结论与证据

原始用例的 `ok=true` 不能直接证明越界写入已经发生。Windows CI 按原样执行该命令后，返回码为 0、没有输出，独立读回的 `outside.txt` 仍为原值；连输出固定标记的命令也没有真正运行。问题是**命令未执行却报告成功**，属于实际执行错误。

原始测试先检查返回值，失败后没有运行后面的文件内容断言，因此原日志本身没有给出“目标文件已改变”的证据。这不是把测试改宽：修复保留外部写入必须失败的要求，并在工作区内写入成功之后增加独立读回，防止空执行再次被当成成功。

真实 Windows 对照记录：

| 运行 | 核对内容 | 实际观察 |
| --- | --- | --- |
| [原发布检查 39117253871](https://github.com/richardguancn/dyworker/actions/runs/39117253871) | 原始返回值断言 | 外部命令返回成功；日志未检查到目标文件实际变化 |
| [首次诊断 39129207451](https://github.com/richardguancn/dyworker/actions/runs/39129207451) | 直接启动 Node，读回文件并记录 ACL | 未观察到外部写入，但已有文件的普通用户侧权限不足，不能据此完成验收 |
| [启动方式对照 39129495339](https://github.com/richardguancn/dyworker/actions/runs/39129495339) | 直接 Node 与旧 `cmd /c` | 直接启动能新建内部文件并拒绝外部写入；旧命令行路径返回 0，但标记和写入均没有发生 |
| [修正方式对照 39129805494](https://github.com/richardguancn/dyworker/actions/runs/39129805494) | 当前用户可写夹具、修正后的命令行启动 | 内部新建和修改成功，外部写入失败；只读模式拒绝所有写入；父目录曾获授权时结果相同 |

第三轮还原样重放原失败命令，记录 `exactLegacyCommand.exitCode=0`、`actualWrite=false`。诊断保留全部启动方式作对照时，旧路径仍导致整体结果为 `probe-inconclusive`，因此前几轮诊断任务为红色；没有把这些对照运行称为完整验收通过。

## 原因与最终实现

官方 Windows 进程层按 `CommandLineToArgvW`/CRT 规则拼接参数，其中双引号使用反斜杠转义。`cmd.exe /c` 的正文使用另一套解析规则，不能直接套用这套拼接。旧调用把带引号的命令当作普通参数传给官方 runner，出现退出 0、正文未执行的结果。

新增 `electron/scripts/windows_command_runner.cjs`。外层 runner 启动 Node；命令通过 base64 参数无损传递给该程序，再按 Node 自身对 `cmd /d /s /c` 的启动约定执行：整体外层引号配合 `windowsVerbatimArguments`。新增程序和其启动的命令继续继承官方受限令牌与 Job；没有把保护失败改为 host 重试。完全访问路径也使用同一正确的命令传递方式，权限模式仍由原审批结果决定。

Electron 场景为这些 Node 引导进程设置 `ELECTRON_RUN_AS_NODE=1`；实际命令恢复调用前的该项环境设置，避免引导标记影响命令启动的其他 Electron 应用。构建复制并自检新增文件，Windows 打包将其解包到与启动路径对应的位置。这些构建设置已检查，不代表已安装应用完成实机验收。

`prepareCommandExecution` 检查保护程度和诊断规则；仅在平台、实际 runner 路径及诊断约定符合当前固定官方 Windows 后端时，明确接受其 `partial` 能力。该标记继续进入前台结果、后台状态及范围说明，不伪装成 `full`。未知部分保护、缺失依据和非法模式仍在启动前拒绝；没有扩大工作区路径或增加长期 host 授权。

前台和后台按后端提供的 `denialSignatures`、`runnerFailureRules` 区分普通命令失败、文件拒绝和 runner 故障。非零退出、规则特定退出码和普通提示整行排除均保留；成功输出同名文本不会被误报为启动故障。诊断按流保留且限制内存，超长输出不会掩盖早期故障或丢失末尾的故障原因。

## 关于两个原假设

1. 忽略后端元信息是本应用的处理缺口，现已补齐；但它不是本次退出 0 的直接原因。当前固定 Windows runner 初始化失败时返回 127，不会在该错误分支裸跑；清理提示可以保留子程序原退出码，不能仅凭前缀断言命令未启动。
2. 本次新建夹具的 ACL 没有呈现“Everyone 获得外部写权限”的假设条件，也未观察到该假设导致的写入。父目录先获授权的对照仍拒绝外部和只读写入。这只说明该假设没有解释本次用例，不证明其他 ACL 配置永远安全。

CI checkout 的默认目录只向 Administrators 组提供写权限。诊断在**自建夹具**上给当前用户 SID 增加 Modify，再检查限制侧：这样工作区外目标对普通调用者可写，仍必须被受限程序拒绝。没有给 Everyone 授权，没有调整仓库根目录或系统临时根目录的权限。生产执行没有加入这种 ACL 修补步骤。

## 验证范围与限制

- macOS 相关真实执行回归（`62ed0a1`）：431 项通过、0 失败、0 跳过，包含原列出的 12 个文件和新增诊断检查。
- 本地新增检查、宿主及权限回归：47 项通过；桌面代码构建通过。
- [Windows 应用及完整回归 39130209970](https://github.com/richardguancn/dyworker/actions/runs/39130209970)（`62ed0a1`）：原动态写入用例及新增前后台、中文和空格、复合命令、退出码、单次授权不延续、只读拒绝等 13 项实测全部通过、0 跳过。`npm run verify` 包含桌面与页面构建及全量回归，1799 项通过、0 失败、47 项依既有条件跳过，包括平台专项、缺少本机转换工具及未启用的真实联调。后续仅补充超长行的诊断原因及启动时的后台范围标记，并在专用分支继续验证。
- 当前官方 Windows 后端仍是部分文件写入保护。硬链接等同一文件多路径的已知边界、读取/联网不在其隔离承诺中，本次没有将其升级为绝对文件边界。
- 本次没有验证安装版，也没有发布应用或合并主分支。

原始产物已从 CI 下载，本地留存于 `docs/verification/windows-command-protection-2026-10-18/`。CI 工作流在失败时仍上传 JSON 和测试输出；其历史产物保留期为 14 天。

## 重跑

在真实 Windows 的仓库根目录执行：

```powershell
node scripts/diagnose-windows-command-protection.mjs
node --test --test-concurrency=1 tests/approval-architecture.test.mjs tests/windows-command-execution.test.mjs
npm run verify
```

诊断默认检查修正后的启动方式；加 `--compare-launchers` 可同时重放旧路径和直接启动路径，旧路径的失效会如实记为对照不完整。退出 0 仅表示本次夹具检查通过，不能证明所有 Windows 文件系统配置都安全。
