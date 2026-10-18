# 23 项命令与终端测试失败复核

日期：2026-10-18。代码版本：`67be22f`。本次复核前工作目录没有未提交改动。

## 结论

保持程序、权限策略和测试断言原样，在 Codex 外层受限环境之外串行运行用户列出的 12 个测试文件，结果为 **415 项通过、0 项失败、0 项取消、0 项跳过**，耗时约 69.7 秒。包含报告中的全部 23 项失败测试。

命令执行失败与外层运行环境有关，不能据此认定新增写入保护在正常本机运行时不可用。没有通过删除保护、自动改为完全访问、模拟命令成功或跳过测试解决问题。

## 对照检查

在两个环境中，均通过原有 `Workspace.runCommand` 执行同一条无文件写入的命令 `printf DYWORKER_COMMAND_PROBE`：

| 运行位置 | 实际结果 |
| --- | --- |
| Codex 默认受限环境 | `ok: false`，退出码 71，`sandbox-exec: sandbox_apply: Operation not permitted` |
| 经执行工具批准、在外层受限环境之外 | `ok: true`，退出码 0，输出 `DYWORKER_COMMAND_PROBE` |

第二次仍使用应用默认的 `workspace-write` 执行保护；没有传入 `danger-full-access`。这里扩大的是本次测试进程的运行权限，没有改变应用内的权限设置。

`prepareCommandExecution` 为命令生成受保护的启动方式；此处的系统错误发生在后续启动时，不能笼统表述为该函数自身初始化抛错。

另外，终端测试直接使用 `node-pty`，不调用 `Workspace.runCommand`；DSH 程序执行器也有自己的官方执行路径。因此，23 项全部经过同一个函数的说法不准确。本次单独在默认受限环境复跑首项真实终端测试也通过，未复现此前的 `posix_openpt failed`，无法仅凭历史报错确定其具体成因。12 文件完整复跑中的全部终端测试均通过。

## 实际权限边界检查

完整复跑包括实际进程的动态写入检查：工作区内写入成功、相邻目录写入失败且原文件不变；明确扩大单次权限后可以写入，下一次默认执行仍被拒绝。DSH 程序执行器的私有文件、越界写入、自行启动程序、超时和取消检查也全部通过。

## 复跑方法

以下命令需要在允许创建真实终端、启用系统执行保护的本机环境运行。在 Codex 内复跑时，由执行工具申请外层运行权限；不要为此设置应用完全访问或删除安全断言。

```sh
node --test --test-concurrency=1 \
  tests/terminal.test.mjs \
  tests/agent.test.mjs \
  tests/approval-task-continuity.test.mjs \
  tests/dsh-full-session.test.mjs \
  tests/dsh-ptc.test.mjs \
  tests/approval-architecture.test.mjs \
  tests/approval-context-tools.test.mjs \
  tests/approval-resilience.test.mjs \
  tests/approval-followup.test.mjs \
  tests/security-approval.test.mjs \
  tests/remote-approval.test.mjs \
  tests/dsh-app-runtime.test.mjs
```

完整输出和环境对照见 [复核证据](../verification/command-test-environment-2026-10-18/)。本次只验证上述 12 个文件，没有重跑全部测试、构建或验证其他操作系统及已安装应用。
