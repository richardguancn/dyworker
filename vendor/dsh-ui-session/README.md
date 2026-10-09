# DSH 官方会话界面服务

9 份源文件原样固定于提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`，来源与 SHA-256 见 `sources.json`。构建复用原始 UiSession 和 SlotRegistry，共用宿主的 Cordis、React，保留 MIT 许可。

UiSession 读取实际原始 ClientSessions 的绑定与保留计数。应用当前选中任务取得独立的 `mainView` 引用；切换与离开释放该引用。后台状态来自原始会话目录与控制流，未知状态保持未知。等待交互的优先级、停用委托、完成未读与界面贡献均使用原始实现。

会话界面贡献可用其原始 Controller 绑定取得现有对话来源；转换前须验证确切原始绑定身份。外部根、其他 Controller 或已释放绑定不能借这个转换取得本任务的展示来源。应用原有导航接口与镜像展示对象仍单独保留，不声称它们已经成为完整原始 ClientSessions。

SlotRegistry 为该服务提供实际根数据、范围适配与范围生命周期；应用现有插槽登记仍使用既有展示入口。完整官方页面渲染、InputHub/InputZone、跨根原始目录和连接恢复仍须继续实现及验收，本模块不代表它们已完成。
