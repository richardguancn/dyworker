# Linux 电脑操作

本插件集成 [computer-use-linux](https://github.com/agent-sh/computer-use-linux) v0.7.31，遵循其 MIT 许可。插件仅在 Linux 默认启用，通过项目现有的工具权限和审计机制运行；每个任务使用独立的后台进程，结束或停用时关闭。插件不开放上游的 `run_shell` 工具。

随包包含 x64 和 ARM64 的三个上游程序。x64 文件来自上游对应版本发布包，已核对发布包提供的 SHA-256；它需要 GLIBC 2.39 或更新版本。ARM64 文件由同一版本源码及锁定的依赖，在 Ubuntu 20.04 / GLIBC 2.31 环境编译，以适配较旧的 Linux 环境；已在该隔离环境验证程序启动、工具发现以及插件启停。实际桌面操作还取决于系统的无障碍服务、图形会话和输入组件，尚未在真实麒麟或 UOS 桌面上验证。GNOME Wayland 等环境可能需要上游提供的窗口控制扩展或桌面授权。

ARM64 文件 SHA-256：

- `computer-use-linux`: `6d0f482922af4b88d3e211975bc1d3babac8fbcdd3a998c5c31b1df1589f4bb5`
- `computer-use-linux-cosmic`: `aada706b89f4ae28cb9a7f9a8f7bccb5805db32c438e0c75fe8a642f3e57e072`
- `computer-use-linux-indicator`: `fd1643d00fd670bc31b56c162eed5779cebd1b33d083ea9784bb7f14933f8485`
