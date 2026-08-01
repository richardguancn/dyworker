# DYWorker：媲美ChatGPT/Codex的 AI 工作助手，国产麒麟 V10 也能用

> 选中一个工作文件夹，告诉它你要什么，剩下的交给它：读资料、理内容、写文档、做表格，甚至在有风险的操作前先问你一句"确认吗？"

![DYWorker 主界面 —— 任务对话窗口](https://fastly.jsdelivr.net/gh/bucketio/img4@main/2026/07/31/1785507208850-05bd5b67-b5d5-4504-a9c1-84cf312b4584.png)

## 为什么又做一个 AI 助手？

市面上的 AI 助手不少，但办公场景里总有几个绕不过去的坎：

- **资料不敢上传**。合同、报表、内部文件，传到云端总让人心里没底；
- **只会说不会做**。聊了半天，最后还是得自己动手复制粘贴、整理文件；
- **国产环境没人管**。单位配发的麒麟 V10、ARM 架构国产电脑，很多 AI 工具根本没有安装包，更别提操作本机办公软件了。

DYWorker 就是冲着这三个痛点来的：一个**完全本地运行**的开源 AI 工作助手（MIT 协议），桌面端基于 Electron + React + TypeScript，数据不出本机，而且能真正动手帮你干活。

## 核心能力：不只是聊天，是真的"干活"

### 📁 以工作区为中心的任务对话

选择一个文件夹作为工作区，用自然语言描述目标。助手会自己拆解步骤、逐步执行，任务历史和工作区文件随时可浏览。

![任务对话 + 工作区文件浏览界面](https://fastly.jsdelivr.net/gh/bucketio/img11@main/2026/07/31/1785507487214-938fd4de-0924-4305-9fc9-de80f82568a2.png)

### 📄 办公全家桶读写能力

文本、PDF、Word、Excel、PPT 都能读；还能直接**创建和导出 Word 文档、Excel 表格**——不是给你一段文本让你自己贴，而是直接生成文件放进你的工作区。

![](https://fastly.jsdelivr.net/gh/bucketio/img0@main/2026/07/31/1785507683436-df708ef3-ecbd-48bf-b5b4-aa10b3939ca6.png)


![生成的Word文档](https://fastly.jsdelivr.net/gh/bucketio/img10@main/2026/07/31/1785507864018-82a78fad-e17f-40a8-934c-f64fd1289f66.png)

![生成的Excel文档](https://fastly.jsdelivr.net/gh/bucketio/img11@main/2026/07/31/1785507900991-4b7e1980-d457-48a0-95c1-a245796820dd.png)


![支持类似Codex的可视化展示能力](https://fastly.jsdelivr.net/gh/bucketio/img16@main/2026/07/31/1785509508687-00d637f0-0a29-4168-afaf-d8a20aa82ce0.png)

### 🧠 长期记忆 + 工作模板

告诉它一次"我们单位的公文格式要求"，它就记住了。记忆分偏好、规则、禁忌、事实、经验五类，可以全局通用，也可以只属某个工作区。常用任务还能沉淀为**工作模板**，下次一键复用。

![刚才的对话中已经记了两条记忆](https://fastly.jsdelivr.net/gh/bucketio/img7@main/2026/07/31/1785507748444-777e484a-29a4-45a2-8660-b7446598a3f9.png)

![支持Skills](https://fastly.jsdelivr.net/gh/bucketio/img3@main/2026/07/31/1785509547905-6161ddc3-621a-445e-9c5a-7d6def7985b7.png)

### ⏰ 计划任务与自动续跑

长任务不用守着：支持定时唤醒（1 分钟到 12 小时），任务中断后自动续跑，像个真正的同事一样"记着把事情做完"。

### 🔌 开放模型接入

兼容常见的 **OpenAI Chat Completions 和 Responses API**，已内置 DeepSeek V4 Flash，支持多套模型配置自由切换——DeepSeek、通义、智谱，或是单位内网自建的模型服务，填上地址和密钥就能用。密钥通过**系统安全存储加密保存**，绝不明文落盘。

![支持主流的模型配置](https://fastly.jsdelivr.net/gh/bucketio/img4@main/2026/07/31/1785509652430-a4849bb8-f982-4748-955b-727b3669c52d.png)

### 💬 QQ / 微信消息渠道

不在电脑前也没关系。DYWorker 支持接入 **QQ 官方机器人**和**微信 ClawBot**，手机上发消息就能远程派活、收结果。QQ机器人配置：https://q.qq.com/#/apps

![QQ机器人配置](https://fastly.jsdelivr.net/gh/bucketio/img7@main/2026/07/31/1785509982421-1ce2f380-dac8-4279-b133-b3d015f8d6fb.png)

![消息渠道接入QQ机器人](https://fastly.jsdelivr.net/gh/bucketio/img19@main/2026/07/31/1785510030973-30b667ab-b8a0-496a-b690-59db02cf003a.png)

![QQ远程对话](https://fastly.jsdelivr.net/gh/bucketio/img9@main/2026/07/31/1785512245196-2bff12d4-9797-47fc-bed9-523305f5ad07.png)

![QQ远程对话派任务](https://fastly.jsdelivr.net/gh/bucketio/img3@main/2026/07/31/1785511401791-aed9a4e0-d835-4ce6-b780-ce9eafd3cf80.png)

## 最大亮点：国产电脑开箱即用

这是 DYWorker 最不一样的地方——**它认真对待国产化环境**。

很多 AI 工具对国产平台的支持停留在"理论上能跑"，而 DYWorker 做到了：

### ✅ 原生支持麒麟 V10（ARM64）

一条命令打出 `.deb` 安装包，在 ARM64 的麒麟 V10 电脑上直接安装：

```bash
npm ci
npm run package:linux:arm64
```

### ✅ 一键检查本机操控环境

首次使用，在应用里执行"**检查并安装本机操控环境**"，助手会自动检测 xdotool、wmctrl、python3-pyatspi 等组件，缺什么装什么（安装前请求系统授权），不用自己折腾命令行。

![操作电脑](https://fastly.jsdelivr.net/gh/bucketio/img2@main/2026/07/31/1785512303595-8d6f03bb-829f-41ca-b54b-c8575f70df64.png)

![浏览器打开网址](https://fastly.jsdelivr.net/gh/bucketio/img16@main/2026/07/31/1785512212919-bc2b585a-2d14-448d-ac6a-a2cd83217f17.png)

### ✅ 真正操作国产系统上的办公软件

环境就绪后，DYWorker 可以激活窗口、点击、输入文字——**直接操作麒麟系统里的 WPS 等办公软件**，让 AI 从"动口"变成"动手"。检测到 Wayland 会话时还会贴心提示切换到 X11，确保兼容性。

### ✅ 麒麟/UOS 深度适配

系统级能力通过 systemd-logind / freedesktop D-Bus 对接，麒麟、UOS 上尽力支持，不支持时静默降级，不会报错崩溃。

## 安全：敢让 AI 动手，是因为有"刹车"

让 AI 操作电脑，最怕它"自作主张"。DYWorker 的设计是**全程可审计、关键操作必确认**：

- 🛑 **风险操作先请示**：执行风险命令、修改本机界面前，必须弹窗获得你的确认；
- 🔒 **工作区外必授权**：访问工作区之外的路径会显示完整位置，单次操作单次授权；
- 📋 **操作全程可审计**：文件、命令、联网、外部工具调用全部留痕；
- 🏠 **数据不出本机**：密钥、登录凭据、任务数据只保存在本机用户数据目录。

![风险操作确认弹窗](https://fastly.jsdelivr.net/gh/bucketio/img8@main/2026/07/31/1785512443267-56681d8f-048d-4dc1-bcba-8b7dc74bf2a8.png)

## 一分钟上手

**环境要求**：Node.js 22+、npm 10+，支持 macOS、Windows 10/11、常见 Linux 桌面（含麒麟 V10）。

```bash
# 克隆后安装依赖
npm ci

# 启动桌面开发环境
npm run dev:electron
```

首次启动打开"设置"，填入模型服务地址、模型名称和密钥，就可以开始派活了。

打包也一步到位，且打包前自动跑完全部测试：

| 平台 | 命令 | 产物 |
| --- | --- | --- |
| Windows x64 | `npm run package:windows:x64` | setup.exe（免管理员安装） |
| macOS | `npm run package:mac` | 应用目录 |
| **Linux ARM64 / 麒麟 V10** | `npm run package:linux:arm64` | **.deb 安装包** |

## 写在最后

DYWorker 想做的事很简单：**让 AI 助手在每一台办公电脑上都能用、敢用、好用**——包括那些被主流工具遗忘的国产电脑。

项目以 MIT 协议开源，欢迎试用、提 Issue、贡献代码。

<QRCodeBlock url="https://github.com/richardguancn/dyworker" text="https://github.com/richardguancn/dyworker" size="150" />
Github仓库地址：https://github.com/richardguancn/dyworker

> 项目地址：https://github.com/richardguancn/dyworker
>
> 如果你在麒麟 V10 或其他国产系统上试了，欢迎留言分享体验！

---
