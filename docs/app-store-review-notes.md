# DYWorker App Store 审核员体验指南与说明 (App Review Information)

> 本文档专为 Apple 审核团队（App Review Team）编写，可直接复制或参考填入 App Store Connect 的「App 审核信息」-「备注 (Notes)」与「登录信息 (Sign-In Information)」。

---

## 1. 快速体验说明 (Reviewer Quick-Start Guide)

### 核心功能体验步骤：
1. **启动应用**：首次启动时进入主界面，所有数据和会话均保存在本地沙箱内。
2. **选取测试工作区**：
   - 点击左侧侧边栏的「工作区（Workspace）」或工作区下拉菜单，选择「选择文件夹（Choose Folder）」。
   - 在系统文件选择器中选择任意本地文件夹（例如 Mac 上的 `Documents` 或自建测试文件夹）。
   - 应用将利用 macOS 安全范围书签（Security-Scoped Bookmarks）获得并仅维持该目录的读写权限。
3. **任务交互与文档生成**：
   - 在底部输入框中输入任务指令（例如：“分析本季度的业务重点并起草一份 Markdown 总结报告”）。
   - 应用将展示多步骤任务执行计划、结构化表格和 Markdown 报告。
4. **透明执行轨迹 (Trace Console)**：
   - 点击底部控制台展开按钮或右上角工具栏的 Trace 按钮，可查看透明的执行步骤、工具调用耗时与沙箱安全读写审计。
5. **偏好与多语言切换**：
   - 点击侧边栏左下角「设置 (Settings)」，在「外观 (Appearance)」面板中可实时切换浅色/深色主题，并在语言下拉菜单中快速体验 8 种语言（中文、英文、日文、韩文、法文、德文、西班牙文等）。

---

## 2. AI 模型服务与网络说明 (AI Model Inference)

- **产品属性**：DYWorker 是一款本地优先（Local-First）的桌面端智能工作台软件。
- **免付费体验方式**：
  - 应用自身免费下载，不含内购项目。
  - 用户可在设置中配置自己拥有的第三方兼容 API（如 OpenAI 兼容接口），或连接本地大模型。
  - **审核团队测试配置**：
    - 如审核人员需要进行实时的远程云端模型交互测试，我们在 App Store Connect 审核备注中提供了专用测试端点及测试凭证：
      - **模型服务地址 (Endpoint)**: `https://api.example.com/v1` (审核后台私密提供)
      - **访问密钥 (API Key)**: `sk-appstore-review-token-xxxx` (仅填写在苹果审核后台，不公开入库)
      - **测试模型名称**: `gpt-4o-mini` 或 `default`
    - 应用在未配置密钥时，仍可完整浏览主工作区、查看历史任务、管理插件和配置偏好设置，并给出明确友好的配置指引。

---

## 3. macOS 沙箱与系统权限说明 (App Sandbox & Entitlements)

应用已严格按照《Mac App Store 审核指南》2.4.5 与 5.1.2 规范进行沙箱封装与隔离限制：

1. **工作区文件访问 (Security-Scoped Bookmarks)**：
   - 依赖 `com.apple.security.files.user-selected.read-write`。
   - 仅能访问用户通过 macOS 原生 Open Panel 主动选取的目录；重启后通过安全范围书签恢复授权，应用绝不会主动越权探测系统未授权文件。
2. **网络通信 (Outgoing Network Connections)**：
   - 依赖 `com.apple.security.network.client`，用于连接用户所配置的模型服务 API 及下载扩展清单。
3. **麦克风权限 (Microphone)**：
   - 依赖 `com.apple.security.device.microphone` 与 `NSMicrophoneUsageDescription`。
   - 仅在用户主动点击底部语音输入按钮时请求麦克风，用于语音转写文字，转写前会有明确的交互提示。
4. **禁止任意命令与动态代码执行 (Compliance 2.5.2)**：
   - Mac App Store 商店版构建中已完全安全熔断未受限命令执行接口，不提供未隔离的外部代码下载，确保完全符合苹果商店安全基线。

---

## 4. 审核联系人与支持 (Contact Information)

- **技术支持邮箱 (Support Email)**: `guandengyu@gmail.com`
- **支持网址 (Support URL)**: `https://github.com/richardguancn/dyworker/blob/main/docs/support.zh-CN.md`
- **隐私政策网址 (Privacy Policy URL)**: `https://github.com/richardguancn/dyworker/blob/main/docs/privacy-policy.zh-CN.md`
