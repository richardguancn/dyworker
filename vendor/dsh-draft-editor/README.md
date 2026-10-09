# 官方草稿编辑器

来自 DeepSeek Harness 固定提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，MIT 许可。编辑器、节点、投影、范围映射、复制与撤销保留。构建转换为共享 React/Lexical 的浏览器模块，引用图标由应用提供；应用桥负责保留范围、持久化、取消和实际提交。

命令高亮装饰有一处修正：拆开高亮命令与后续参数时，立即清除后半段继承的高亮样式，避免 Lexical 把两段重新合并后反复拆分。已用失败后的命令在高亮边界输入、全选、粘贴改写复现原错误并检查修正结果；不改变命令判断或引用身份。

本轮还保留同一提交的 `SessionInputShell`、`SubmitMachine`、`ConversationController`、`ComposerBlockRegistry` 及所需契约和草稿模块。提交、回填、附件上传队列与状态仍使用官方实现；`ConversationController` 的应用发送由 `OwnedConversation` 适配到实际任务入口，并增加根会话归属检查。`SessionInputShell` 的三处宿主桥明确标注为 DYWorker bridge：暴露同一编辑器运行对象、取消保留输入的在途操作、阻止销毁后的编辑提交重新取得会话。原生附件适配另外增加可选宿主输入快照：在异步引用与命令处理前固定本次选择，默认发送和接受附件的命令合并原生及浏览器附件；失败、取消、选择变化均不消费。普通发送同时保留原引用显示快照，模型转换仍由原来源完成。未提供该宿主选项时保持官方原有处理。SubmitMachine 未修改。公开会话解析由宿主绑定代次管理，尚未宣称完整原样 InputHub 或官方会话浏览器层已接入。
