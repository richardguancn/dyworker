# Windows 命令环境与 Koffi 加载故障

## 现象与判断

用户报告 Windows 任务经常得到其他平台的脚本，并出现 `windows-acl-run: Cannot find the native Koffi module; did you bundle it correctly?`、退出码 127。

这条错误来自保护程序加载 Koffi 的失败，不能据此判断用户命令的语法是否正确。代码检查另外发现，`run_command` 实际使用 `cmd.exe /d /s /c`，此前模型提示和工具说明没有明确区分 cmd、PowerShell 与 Bash。

## 修改

- 两种任务运行方式共用本机命令指引：Windows 命令使用 cmd，PowerShell 要显式调用；复杂脚本优先保存文件后执行，不照搬技能中的 Bash 示例，不假定额外解释器已经安装。命令工具说明也直接标明解释器。
- 明确保护组件故障与脚本错误的区别，避免反复改写命令或通过扩大权限绕过故障。
- 显式声明 Windows x64 的 Koffi 可选依赖。打包时核对目标平台和版本，将二进制复制到 Koffi 实际支持的 `build/koffi/<triplet>/koffi.node` 目录；缺少依赖或版本不一致时停止出包。
- 核对官方保护程序身份之后，将其启动路径指向 `app.asar.unpacked`。保护参数与保护程度保持原样。
- Windows 本机打包完成后，使用包内 Electron 和应用入口检查工作区真实写入、中文与空格路径、工作区外写入拒绝、只读写入拒绝。任一失败均阻止出包；跨平台打包仍会检查并复制目标组件，但不能代替 Windows 运行验证。

## 实际验证与边界

在 macOS 使用真实 Koffi 建立独立目录，删除平台依赖后复现相同报错；补齐二进制后实际加载成功。

另用 Electron 创建并运行最小 `app.asar` 包，验证了存储路径的区别：打包完成后新增的物理文件不在原归档目录记录中，从归档路径加载仍报相同错误；从 `app.asar.unpacked` 加载成功。这是除补齐文件外，还须修正独立保护程序启动位置的依据。该试验使用本机 macOS 二进制，不能视为 Windows ACL 验证。

自动检查覆盖实际模型请求（含独立子任务）、命令保护的前后台故障处理、打包钩子、版本不一致、缺少文件、真实 Koffi 加载，以及已识别 Windows 入口的路径转换和权限参数保留。桌面构建通过。

当前没有可用的 Windows 实机验证环境；GitHub 命令行现有登录凭据失效，未能启动远程 Windows 验证。仓库已有 Windows 平台专项检查，本次还增加了 Windows 打包时的运行检查，但未在当前会话执行这些 Windows 检查。没有生成或发布 Windows 安装包，也没有把本机模拟检查称为 Windows 实机通过。
