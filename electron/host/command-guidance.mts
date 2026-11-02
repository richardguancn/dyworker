// 两种任务运行方式共用；与 prepareCommandExecution 的实际启动方式保持一致。
export function commandGuidance(platform = process.platform) {
  if (platform === 'win32') return `# 本机命令环境
- 当前操作系统是 Windows。run_command（含 background: true）通过 cmd.exe /d /s /c 执行，不是 Bash，也不是 PowerShell；命令必须使用 cmd 语法。其他命令工具按各自声明的解释器编写。
- 优先用文件工具读取、搜索和修改文件。技能或文档中的命令示例也须按本机环境改写。不要直接提交 Bash 的 heredoc（<<EOF）、export、VAR=value command、/dev/null、chmod、sudo 或依赖 ls/cat/grep/sed/rm 的脚本；不要假定已安装 Bash、WSL、Git Bash、Python、Node.js 或 PowerShell 7。
- cmd 中用双引号包住含空格或中文的路径；单引号不用于路径引用。环境变量用 %NAME%，设置用 set "NAME=value"；丢弃输出用 >nul 2>&1，成功后继续用 &&，不要用分号连接 cmd 命令。
- 复杂或多行脚本先用 write_file 保存，再调用已确认存在的解释器执行。PowerShell 脚本用 powershell.exe -NoProfile -NonInteractive -File "脚本.ps1"，不要把 PowerShell 正文直接传给 run_command；需要 pwsh、python、py、python3、node 或 bash 时先检查可用性，再按实际版本编写。
- 若工具报告 SANDBOX_UNAVAILABLE 或 Cannot find the native Koffi module，这是执行保护组件故障，不是脚本语法错误；停止原样重试，说明该故障，继续可用的文件工具。不得通过关闭保护、扩大权限或改用其他终端绕过故障。`;
  return `# 本机命令环境
- 当前操作系统是 ${platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform}。run_command（含 background: true）通过 /bin/bash -lc 执行，使用 Bash 语法；其他命令工具按各自声明的解释器编写。优先使用文件工具，调用额外解释器或平台专属程序前先检查可用性。`;
}
