# DSH 官方会话历史和客户端

源文件原样保存自固定提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。来源及 SHA-256 见 `sources.json`，许可证见 `LICENSE`。

37 份源文件构建原始 Session、SessionManager、ClientSessions、createSessionControlStream、SessionEventStream、RemoteJournalStream、RemoteStream，以及后台 SessionHistoryController、SessionControlController、ApiSessionList、原始子任务目录折叠和助手基线累积器。Gateway 仅导出这些实际使用的原始构件，失败识别函数从同一原始 index.ts 提取，不引入整个浏览器 Gateway 服务。官方文件不改写。

Electron 传输由应用提供，正式事件、助手帧及状态投影保持原样，地址须通过根任务及直接父子归属检查。状态范围只包含此根任务及官方目录中通过原始描述验证的后代。所属子页面共用这个根客户端的状态订阅，自己的历史和图片仍按确切子任务地址读取。官方 API 列表和同源会话/Agent 事件交给原始管理器处理，运行状态与子目录变化触发更新，DSH 页面不再定时查询 history-state。读取不启动模型；前后台读取取消只能释放自己的跟随者。

每个确切根任务共用原始 ClientSessions；根和所属子任务的页面及公开 retain/using/retainInfo/sessionOf 使用原始身份、来源计数、独立等待和释放。Cordis sessions 服务显式隔离，保留应用导航兼容入口；原始 private scope 标记识别父子，避免把子输入误认成父输入。原始图片读取自己解码传输内容。应用为缓存的已释放对象增加操作保护，拒绝迟到读取、输入与取消，原始源文件保持不改写。

原始客户端现在可以搜索所属根任务及子任务的真实消息、修改父子标题，并在当前授权运行中执行官方命令。搜索使用原始 ApiSessionList 和 SQLite 查询，在排名前限定实际目录身份；冷子任务改名仅取得日志写入权，使用官方标题规范，不恢复 Agent 或模型。标题及命令结果实际保存；根标题同时更新应用列表。命令取消只收尾自身，附件由原始执行器按确切 Agent 验证。应用全局搜索也已接入：只遍历已登记根任务的原始父子目录，按原描述及确切工作目录验证后，交给一个官方 SQLite 查询统一排名。搜索有独立的页面及请求取消归属，冷读取不打开模型进程。运行中的真实记录先经原存储完成保存再检索，不增加人工拼造的事件。

创建与分叉已经通过真实原生存档发布及原始 seed/附件保存接入。UiSession 使用另行固定的官方源文件，主界面选择取得独立 mainView 引用；贡献、等待交互与运行/完成状态来自原始服务及控制事件。原始引用进入现有对话展示时先核对它仍属于确切 Controller，再映射到该任务的实际对话来源。

完整跨根目录/选择服务、其余原始 UiSession 渲染消费者、InputHub/InputZone、完整连接代次重连及真实窗口按钮仍需继续接入和验收，不能把这些能力称为完整插件客户端。当前生成模块共用宿主 Cordis；后台使用同一个 zod 与官方错误类型，避免重复实例造成识别差异。所有生成模块保留 MIT 许可。
