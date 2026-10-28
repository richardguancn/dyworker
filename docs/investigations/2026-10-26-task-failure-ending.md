# 任务失败后正文停在进度说明

日期：2026-10-26。

## 已确认的原因

本机 10 月 25 日和 26 日两次晨报任务的最后状态均为 `error`，最后一条主活动记录均为模型回复格式错误，发生在 `view_image` 之后。正文仍保留了先前的“现在核验……”说明。

自动任务收集器与渠道发送使用 `result.finalText || result.reason`，已有进度正文会遮住错误原因。实时结束事件同样只采用正文，没有合并停止原因。普通聊天此前已有单独追加错误原因的处理，各入口行为不一致。

这只能确认失败发生的时间位置，不能据此确定模型服务为什么拒绝含图片的请求。

## 修改范围

- 共用失败收尾文案，保留已生成文字，同时明确说明“任务未完成，已停止”和原因。
- 覆盖普通聊天、定时任务、自动续跑、渠道回复及实时结束事件。
- 存档单独保存停止原因；多轮会话只给最后一轮补充失败提示，不覆盖前面已完成的回复。
- 定时计划摘要优先保存失败说明，避免较长的进度文字挤掉停止原因。
- 展示历史失败会话时，从最后一次主模型请求的失败记录恢复原因；不使用早先已恢复的工具错误或子任务错误，不改写原始存档。

未修改模型请求的图片兼容处理，未替换 `/Applications/DYWorker.app`，未修改正式用户资料。

## 实际验证

`npm run build` 成功，包含桌面构建、页面类型检查与页面构建。

以下检查共 123 项，全部通过，无失败、跳过或取消：

```sh
node --test --test-concurrency=1 tests/model-stream-safety.test.mjs tests/task-result.test.mjs tests/task-failure.test.mjs tests/process-commentary.test.mjs tests/process-transcript.test.mjs tests/dsh-entry-turns.test.mjs tests/dsh-scheduled-runtime.test.mjs tests/dsh-channel-wake-runtime.test.mjs tests/channel-stream.test.mjs tests/schedule-live.test.mjs tests/session-store.test.mjs tests/wake-scheduler.test.mjs tests/wake-note.test.mjs tests/scheduler.test.mjs
```

隔离测试使用独立临时资料目录、本机模拟模型服务和实际 Electron 应用页面，不使用正式会话或在线模型。通过 agent-browser 实际操作并检查：

1. 打开历史失败会话，折叠过程时也能直接看见停止原因。
2. 普通聊天先返回进度、执行只读工具，再返回格式异常：进度保留，失败原因显示一次，输入框恢复可用。
3. 随后发送正常任务：显示正常完成文字，没有附加失败提示。
4. 从“计划任务”页面点击“立即执行”：自动打开的会话中显示进度和完整停止原因。
5. 重新加载页面：失败说明完整保留，没有重复追加。

实际页面截图：

- [历史失败会话](../verification/task-ending-2026-10-26/history.png)
- [计划任务失败收尾](../verification/task-ending-2026-10-26/schedule.png)

这些验证证明失败提示的修复，不证明真实模型服务的看图异常已解决。
