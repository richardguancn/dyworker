# 银河麒麟 V10 Computer Use 技术路径调研

2026-09-19 完成。问题分两部分：(1) Kylin V10 桌面环境下 GUI 自动化（截屏、键鼠控制、窗口信息）的技术路径与优化点；(2) 主流 agent 产品（OpenAI Codex、Kimi、Anthropic）为何把 Computer Use 做成独立插件/独立环境而非内置工具。所有结论均附一手来源链接（官方文档、源码仓库、官方公告）；标注「经验判断」的条目没有一手出处，属于工程推断。

## 一、Kylin V10 桌面与显示服务器：X11 还是 Wayland

- Kylin V10 桌面环境为 UKUI，窗口管理器 ukui-kwin 是 KWin 的分支（"Ukui-kwin is the default window manager for UKUI desktop environment, and is forked from kwin"）。[ukui/ukui-kwin README](https://github.com/ukui/ukui-kwin)
- KWin 本身同时支持 X11 与 Wayland 两种后端（"Window Manager for Xorg windowing systems (Wayland, X11)"），openKylin 的 KWin 分支镜像了这一描述；ukui-kwin 同样存在 x11 与 wayland 两套打包（openEuler 的 ukui-kwin.spec 即按 KWin 5.27.5 构建，麒麟知识库中 V10 SP1 的已知问题条目以 `ukui-kwin-x11` 进程为例，说明 V10 SP1 桌面默认会话为 X11）。[openKylin/kwin（Gitee）](https://gitee.com/openkylin/kwin?skip_mobile=true)、[麒麟官方知识库条目的转载（51CTO）](https://blog.51cto.com/u_16099300/7191064)、[src-openEuler ukui-kwin.spec](https://gitee.com/src-openeuler/ukui-kwin/blob/master/ukui-kwin.spec)
- 麒麟官方按 CPU 架构分发不同镜像：V10 SP1 有 X86 版（兆芯/海光）、HWE X86 版（Intel/AMD）、ARM64 版（飞腾/鲲鹏）、LoongArch 版（龙芯），镜像命名直接来自 iso.kylinos.cn 下载链接。[镜像清单转载（腾讯云开发者社区）](https://cloud.tencent.com/developer/article/2619902)、[福州大学网信办公告（指向麒麟官网文档页）](https://wxb.fzu.edu.cn/info/1080/2194.htm)
- 结论：V10 桌面默认 X11（UKUI on ukui-kwin-x11），X11 工具链可直接使用；部分版本/定制镜像可能有 Wayland 会话，必须以目标机器实测为准（`echo $XDG_SESSION_TYPE`、`ps aux | grep kwin`）。这一「先探测再选路」的策略与显示服务器强绑定，是后续所有工具选型的前提（经验判断）。

## 二、X11 路径：工具可用性与截图性能

- **xdotool**：通过 X11 的 XTEST 扩展模拟键盘鼠标、查询/移动/改窗口属性，是事实标准的输入注入与窗口信息工具；官方 README 明确警告 **Wayland 下不能正常工作**（typing、window search 等大量功能失效），并推荐 Wayland 改用 ydotool/dotool。[jordansissel/xdotool README](https://github.com/jordansissel/xdotool)
- **scrot**：基于 imlib2 的命令行截图工具，支持窗口/区域截图、多格式；在麒麟源或源码编译都容易获得（依赖 X11 + libXcomposite/libXfixes/libXrandr）。[resurrecting-open-source-projects/scrot README](https://github.com/resurrecting-open-source-projects/scrot)
- **ImageMagick `import` / `xwd`**：同为 X11 抓屏工具。Anthropic 官方 computer use demo 的实现就是：截图优先 `gnome-screenshot`、回退 `scrot -p`，再用 ImageMagick `convert -resize` 把图缩到 XGA/WXGA；输入全部走 `xdotool`（mousemove/click/key/type/getmouselocation）。这验证了「xdotool + scrot + convert」组合是 Linux computer use 的参考实现级选择。[computer.py 源码（anthropics/claude-quickstarts）](https://raw.githubusercontent.com/anthropics/claude-quickstarts/main/computer-use-demo/computer_use_demo/tools/computer.py)
- **ffmpeg `x11grab`**：FFmpeg 官方的 X11 视频输入设备（依赖 libxcb），适合持续抓帧/录屏类场景，比每次 fork 截屏进程更省开销。[FFmpeg 设备文档 x11grab 节](https://ffmpeg.org/ffmpeg-devices.html)
- 截图性能优化点（经验判断，组合依据见上）：(a) 避免每个动作后全屏截原图再缩放——参考实现统一把发送给模型的图缩到 ≤WXGA，降低带宽与模型侧图像 token；(b) 高频截屏用常驻进程（ffmpeg x11grab 或 XShm 共享内存路径）而非反复 fork scrot/import；(c) 截图前留 2s 稳定延时（Anthropic 参考实现 `_screenshot_delay = 2.0`）。[computer.py](https://raw.githubusercontent.com/anthropics/claude-quickstarts/main/computer-use-demo/computer_use_demo/tools/computer.py)、[demo README（屏幕尺寸建议）](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/README.md)
- 窗口信息获取：`xdotool search/getwindowgeometry/getactivewindow getmouselocation` 即可覆盖窗口列表、几何、焦点窗口、光标位置；KWin 系还支持 `qdbus org.ukui.KWin` 类接口（经验判断，ukui-kwin 为 KWin 分支）。

## 三、Wayland 路径：grim/ydotool/uinput 与权限

- Wayland 下传统 X11 自动化工具失效是官方共识：xdotool 自述 Wayland 下打字、窗口搜索等功能不可用且「不清楚能否实现」。[xdotool README Wayland 节](https://github.com/jordansissel/xdotool)
- **ydotool**：不依赖 X，通过 Linux 内核 uinput 框架注入输入，X11/Wayland/文本控制台均可使用；`ydotoold` 守护进程自 v1.0.0 起**必需**（持有一个持久的虚拟输入设备，避免图形环境来不及识别新设备）；守护进程需要访问 `/dev/uinput`，**通常需要 root**。内核 uinput 文档确认：向 /dev/uinput 写入即可从用户态创建虚拟输入设备并发送事件。[ydotool README](https://github.com/ReimuNotMoe/ydotool)、[Linux 内核 uinput 文档](https://docs.kernel.org/input/uinput.html)
- **grim/slurp**：Wayland 合成器抓图与区域选择工具，属于 wlroots 生态（官方示例基于 sway/slurp）；非 wlroots 合成器（GNOME/KDE 系）不适用同一协议路径。[emersion/grim README](https://github.com/emersion/grim)
- **wayvnc**：官方明确仅支持 wlroots 系 Wayland 合成器，**GNOME、KDE、Weston 均不支持**；它 attach 到运行中的会话、创建虚拟输入设备并通过 RFB 协议暴露显示，可跑 headless 会话。[any1/wayvnc README](https://github.com/any1/wayvnc)
- 权限模型差异（关键限制）：Wayland 把「屏幕内容不可被任意客户端读取」作为安全设计，截屏/录屏要走合成器/桌面门户授权（经验判断，Electron 的 PipeWire 行为即体现这一点，见第五节）；输入注入则下沉到内核 uinput，代价是要 root 或 udev 规则放行 `/dev/uinput`。在麒麟若坚持用默认 X11 会话，这套限制整体可以绕开。

## 四、VNC/RDP 类后端

- **x11vnc**：面向真实 X11 显示的 VNC 服务器（attach 现有 :0 显示），是 X11 会话下最成熟的远程桌面后端，可同时承担「截屏 + 反向输入 + 人工旁观」。[LibVNC/x11vnc 仓库](https://github.com/LibVNC/x11vnc)
- **wayvnc**：见上，仅 wlroots 系 Wayland；麒麟 UKUI（KWin 系）若在 Wayland 会话下不能指望 wayvnc。[wayvnc README](https://github.com/any1/wayvnc)
- **参考架构**：Anthropic computer use 参考实现就是「Docker 容器 + 虚拟 X11 显示（Xvfb）+ Mutter/Tint2 桌面 + x11vnc/noVNC（5900/6080 端口）」，把被控桌面整体放进可丢弃容器，agent 通过 VNC 画面与人共享同一环境。[Anthropic computer use 文档（computing environment）](https://docs.claude.com/en/docs/agents-and-tools/computer-use)、[computer-use-demo README](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/README.md)
- 可行性结论：麒麟 X11 会话下 x11vnc 直接可用；VNC 方案的价值在于天然提供隔离边界（远端/容器内桌面）与人工接管通道，代价是多一层编码延迟，不适合对单步延迟敏感的细粒度控制（经验判断）。

## 五、Electron/Chromium 应用在麒麟上截屏的已知问题

- Electron `desktopCapturer` 在 Linux 上经 PipeWire 时**只返回单一 source**（屏幕和窗口类型混用时返回的是窗口 capture）；这直接约束了用 Electron 自带能力做多窗口截屏的方案。[Electron desktopCapturer 文档（Linux Caveats）](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- PipeWire 路径通常伴随桌面门户（portal）授权弹窗，agent 无人值守场景会被卡住（经验判断，由上述 PipeWire 行为推导）。
- 国产 ARM（飞腾/鲲鹏）整机 GPU 驱动成熟度参差，Electron/Chromium 常需关闭硬件加速兜底；Electron 官方提供 `app.disableHardwareAcceleration()`（"Disables hardware acceleration for current app"）。[Electron app 文档](https://www.electronjs.org/docs/latest/api/app)
- GBM/DRM 路径：FFmpeg 的 `kmsgrab` 输入设备可从 DRM/KMS 抓帧（绕过 X/Wayland 协议层），但对权限和驱动有要求，属于进阶选项。[FFmpeg 设备文档 kmsgrab 节](https://ffmpeg.org/ffmpeg-devices.html)
- 对 DYWorker 的推论：Electron 应用若要做 computer use 宿主，麒麟 X11 会话下 `desktopCapturer` 可用但受 PipeWire 单 source 限制；更稳的路线是宿主只负责调度，截屏/输入交给系统工具（scrot/xdotool 或 ydotool），与 Anthropic/OSWorld 参考实现保持一致（经验判断）。

## 六、国产 CPU（ARM64/LoongArch）上的打包与性能注意事项

- 麒麟按架构分发镜像（x86/兆芯/海光、ARM64/飞腾/鲲鹏、LoongArch/龙芯），见第一节；同一套工具链需要按架构分别打包或从麒麟源安装。[镜像清单](https://cloud.tencent.com/developer/article/2619902)
- 纯 Python 栈（PyAutoGUI/Pillow）可移植性最好：OpenAI 官方 computer use 指南的桌面示例就是让模型写 Python、在持久桌面运行时里用 PyAutoGUI 操作并 `pyautogui.screenshot()` 回图；OSWorld 的动作空间也是 pyautogui。[OpenAI computer use 指南](https://platform.openai.com/docs/guides/tools-computer-use)、[OSWorld README](https://github.com/xlang-ai/OSWorld)
- C 工具链（xdotool、scrot/imlib2、ydotool）在 ARM64/LoongArch 上需对应架构的 deb 或源码编译；ydotool v1.0.0 起无外部依赖、纯 C99，利于离线交叉编译（官方 README 称 "Some people can finally build this project offline"）。[ydotool README](https://github.com/ReimuNotMoe/ydotool)
- 性能：国产桌面 ARM CPU 单核性能弱，截图缩放、图像编码是热点；务必把发给模型的截图控制在 XGA/WXGA（Anthropic 明确不建议发超过 XGA/WXGA 的截图，否则会降低模型准确率并拖慢性能）。[demo README](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/README.md)

## 七、已知开源项目怎么实现 Linux computer use

| 项目 | 截屏 | 输入 | 环境/隔离 |
|---|---|---|---|
| Anthropic computer use demo | gnome-screenshot，回退 scrot；ImageMagick 缩放 | xdotool（XTEST） | Docker 容器 + Xvfb + Mutter/Tint2 + x11vnc/noVNC |
| OSWorld | 宿主机指令 + 客户端 pyautogui 截图 | pyautogui | VMware/VirtualBox/AWS/Azure/Docker 虚拟机 |
| OpenAI（CUA/Operator） | 应用侧执行，回传 screenshot（PyAutoGUI/Pillow 或 Playwright） | 模型生成 PyAutoGUI/Playwright 代码或结构化动作，由应用翻译 | 要求 isolated browser/VM + 域名 allowlist |
| trycua/cua | Sandbox SDK capture screenshots | Cua Driver（跨 macOS/Windows/Linux） | 云端/本地隔离桌面（Fleet、Lume VM） |

来源：[computer.py](https://raw.githubusercontent.com/anthropics/claude-quickstarts/main/computer-use-demo/computer_use_demo/tools/computer.py)、[demo README](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/README.md)、[OSWorld README](https://github.com/xlang-ai/OSWorld)、[OpenAI computer use 指南](https://platform.openai.com/docs/guides/tools-computer-use)、[trycua/cua README](https://github.com/trycua/cua)

共同点：截屏/输入工具保持极简（xdotool/scrot/pyautogui），把复杂度花在「环境隔离 + 分辨率缩放 + 动作后验证」上；没有任何一个参考实现把 computer use 直接跑在用户日常桌面里。

## 八、为什么 agent 产品把 Computer Use 做成独立插件/独立环境

### OpenAI Codex（官方文档）

- 云端任务运行在「isolated OpenAI-managed containers」，无法访问宿主机或无关数据；两阶段运行时：setup 阶段可联网装依赖，agent 阶段默认离线，环境密钥只在 setup 阶段可用、agent 阶段前移除。[Codex agent approvals & security](https://developers.openai.com/codex/security)
- 本地默认 OS 级沙箱（macOS Seatbelt、Linux bwrap+seccomp、Windows 原生 sandbox）+ 独立审批策略，两者是两个维度：沙箱决定「技术上能做什么」，审批决定「何时必须停下来问人」；网络默认关闭，写权限默认限工作区。[同上](https://developers.openai.com/codex/security)
- Computer Use 在 Codex 里是**独立受管能力**：网络代理等命令沙箱策略「不过滤 browser 或 Computer Use activity」，管理员需为 Computer Use 单独设置 feature requirement——即权限边界按能力单独划分。[同上](https://developers.openai.com/codex/security)

### Kimi（官方文档与公告）

- Kimi 把 Computer Use 做成 **Kimi Code 的官方插件**（Kimi Computer Use，当前 v0.5.4），从 `/plugins` 市场安装，**安装时自动配置托管运行时**；与 Kimi Datasource、Kimi Browser Extension 并列，属少数官方内置插件。[Kimi Code plugins 文档（Kimi Computer Use 节）](https://github.com/MoonshotAI/kimi-code/blob/main/docs/zh/customization/plugins.md#kimi-computer-use)、[Kimi Code CLI 变更记录 0.33.0/0.34.0](https://moonshotai.github.io/kimi-code/zh/release-notes/changelog.html)
- 插件化的直接理由写在产品形态里：(a) **权限引导独立**——macOS 首次使用要单独授权「辅助功能」（执行点击输入）与「屏幕录制」（读屏），并单独接入本地 Agent；(b) **平台差异收敛进插件**——Windows 版无法像 macOS 那样后台静默输入，会短暂占用真实键鼠，需要独立的系统要求说明；(c) **可随时禁用**——插件 MCP server 可从 `/plugins` 单独禁用，插件整体可 enable/disable/remove。[plugins 文档](https://github.com/MoonshotAI/kimi-code/blob/main/docs/zh/customization/plugins.md)
- 运行时闭源（manifest 标记 Proprietary）、按 OS 打包插件（macOS 10 个工具、Windows 13 个工具）并捆绑 OS 专项 Skill（含 AX/UIA vs 像素、过期观察、敏感动作等操作策略），第三方产品化对比（Qwen Code issue #8713）也印证「托管运行时 + 窄工具面 + 权限引导」是 Kimi 刻意的产品边界。[QwenLM/qwen-code#8713](https://github.com/QwenLM/qwen-code/issues/8713)

### Anthropic（官方文档，作为对比）

- Computer use 是 beta 能力，官方明确其风险「不同于标准 API 功能」，给出的首要防护就是**专用虚拟机或最小权限容器**、敏感数据不入场、互联网访问域名 allowlist、有现实后果的操作要人工确认；参考实现整体跑在 Docker 容器里。[Anthropic computer use 文档](https://docs.claude.com/en/docs/agents-and-tools/computer-use)、[demo README 安全须知](https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/README.md)
- 上下文膨胀有官方量化依据：computer use beta 给系统提示词增加 **466–499 token**，computer 工具定义本身 **735 token/次**，再加每张截图的 vision 输入——这是把它做成可开关、按需加载能力的直接成本动因。[Anthropic computer use 文档（Pricing）](https://docs.claude.com/en/docs/agents-and-tools/computer-use)
- 数据面也隔离：computer use 是 client-side 工具，截图与动作数据留在用户环境、Anthropic 不保留（因此可 ZDR）。[同上（Data retention）](https://docs.claude.com/en/docs/agents-and-tools/computer-use)

### 共性结论

三家给出的理由高度一致，可归为四点：

1. **安全隔离是第一位的**：computer use 能操作真实 UI、产生真实后果，必须放进 VM/容器/独立插件运行时，并配合最小权限、域名 allowlist、人工确认（Anthropic、OpenAI 官方原文；Kimi 用授权窗口 + 可禁用插件实现同边界）。
2. **权限边界按能力划分、可单独撤销**：macOS 辅助功能/屏幕录制要单独授权；Codex 把 Computer Use 列为独立受管 feature；Kimi 插件可整体禁用、MCP server 可单独禁用。
3. **上下文/token 成本控制**：工具定义 + 系统提示词 + 截图持续消耗大量上下文，按需加载（插件化）比常驻内置更省（Anthropic 给出 466–499 + 735 token 的量化数据；Kimi 插件文档也规定 systemPrompt 注入 32KB/插件、合计 64KB 上限）。
4. **平台差异与运行时不确定性收敛在独立单元里**：macOS 后台 AX 事件、Windows 前台真实输入、Linux 工具链各不相同，由插件/环境自带 OS 专项 Skill 与托管运行时消化，主 agent 工具面保持窄而稳定（Kimi、Qwen 对比、Anthropic 参考实现均如此）。

对 DYWorker 的启示：computer use 不应作为常驻内置工具平铺进主 agent，而应做成可安装/可禁用的插件或独立子进程环境，自带权限引导、OS 专项策略与隔离边界；麒麟 Linux 上具体工具链按第一节探测结果在 X11（xdotool/scrot）与 Wayland（ydotool/grim/portal）之间路由（经验判断）。
