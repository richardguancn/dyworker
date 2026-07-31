# DYWorker

DYWorker 是一款本地运行的 AI 工作助手。用户选择工作文件夹并描述目标后，助手可以读取资料、整理内容、生成文件、操作办公软件，并在有风险的操作前请求确认。

本仓库只保留当前 Electron + React + TypeScript 桌面版，不包含旧 Qt/C++ 版本、历史构建产物、界面评审截图和在线原型托管代码。

## 主要能力

- 图形化任务对话、任务历史和工作区文件浏览
- OpenAI 兼容模型服务与多套模型配置
- 文本、PDF、Word、Excel、PPT 等办公资料读取
- 文件创建、修改、整理和导出
- 长期记忆、工作模板、计划任务和自动续跑
- 可审计的文件、命令、联网和外部工具授权
- macOS 与 Linux 桌面应用操作
- QQ 官方机器人和微信 ClawBot 消息渠道

## 开发环境

- Node.js 22 或更高版本
- npm 10 或更高版本
- macOS、Windows 10/11，或常见 Linux 桌面系统

安装依赖：

```bash
npm ci
```

启动桌面开发环境：

```bash
npm run dev:electron
```

只启动网页界面：

```bash
npm run dev
```

## 检查代码

运行全部自动测试：

```bash
npm test
```

检查类型并生成正式页面：

```bash
npm run build
```

一次完成构建和全部测试：

```bash
npm run verify
```

## Windows 打包

推荐在 Windows 10 或 Windows 11 的 PowerShell 中打包。

```powershell
cd C:\path\to\dyworker
npm ci
npm run package:windows:x64
```

打包前会自动执行构建和全部测试。成功后，安装程序位于：

```text
output/electron/dyworker-版本号-windows-x64-setup.exe
```

安装程序默认按当前用户安装，允许用户选择安装目录，不要求管理员权限。

未签名的安装程序可能触发 Windows SmartScreen 提示。正式公开发布时，建议配置 Windows 代码签名证书后再打包。证书和密码不要写入仓库，应通过本机环境变量或持续集成平台的密钥管理功能提供。

如需在 macOS 或 Linux 上交叉生成 Windows 安装程序，建议使用 electron-builder 官方的 Wine Docker 镜像：

```bash
docker run --rm -it \
  --platform linux/amd64 \
  -v "$PWD:/project" \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -lc "npm ci && npm run package:windows:x64"
```

最可靠的发布方式仍是在对应系统上打包：Windows 安装程序在 Windows 上生成，macOS 包在 macOS 上生成，Linux 包在 Linux 上生成。

## macOS 打包

使用当前 Mac 的处理器架构生成未压缩应用目录：

```bash
npm ci
npm run package:mac
```

输出位于 `output/electron/`。

## Linux ARM64 打包

在 ARM64 Linux 或麒麟 V10 电脑上生成 `.deb` 安装包：

```bash
npm ci
npm run package:linux:arm64
```

输出位于 `output/electron/`。Linux 桌面操控建议使用 X11 会话；首次使用时可在应用中执行“检查并安装本机操控环境”，按提示安装缺少的系统组件。

## 模型配置

首次启动后打开“设置”，填写模型服务地址、模型名称和密钥。DYWorker 兼容常见的 OpenAI Chat Completions 接口。模型密钥使用系统安全存储加密保存；系统安全存储不可用时不会退回明文保存。

## 安全说明

- 工作区外路径会显示完整位置，并针对单次操作请求授权。
- 风险命令和本机界面修改会请求确认。
- 密钥、登录凭据和任务数据只保存在本机用户数据目录。
- 对外发布或共享资料前，建议先运行敏感信息检查。
- 不要提交 `.env`、证书、私钥、模型密钥或本机用户数据。

## 项目结构

```text
build/       打包图标
electron/    桌面主进程、智能助手、渠道和本机能力
src/         React 界面
tests/       自动测试
index.html   页面入口
package.json 项目命令和打包配置
```

## 参与开发

提交改动前请至少运行：

```bash
npm run verify
```

修复问题时请补充能够复现问题的自动测试。不要提交 `node_modules/`、`dist/`、`output/` 或任何真实密钥。

## 开源许可证

本项目使用 [MIT License](LICENSE)。
