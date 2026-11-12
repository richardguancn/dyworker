// 两种任务运行方式共用；与 prepareCommandExecution 的实际启动方式保持一致。
export function commandGuidance(platform = process.platform, locale = 'zh-CN') {
  const isZh = locale.startsWith('zh');
  if (platform === 'win32') {
    return isZh
      ? `# 本机命令环境
- Windows 下 run_command 通过 cmd.exe /d /s /c 执行（非 Bash/PowerShell）：路径用双引号，变量用 %NAME% / set "NAME=value"，丢弃输出用 >nul 2>&1，连接用 &&（勿用分号或 <<EOF / export / chmod / sudo）。
- 多行脚本先 write_file 再调用已确认存在的解释器；PowerShell 用 powershell.exe -NoProfile -NonInteractive -File "脚本.ps1"。
- 遇 SANDBOX_UNAVAILABLE 或 Cannot find the native Koffi module 属保护组件故障，立即停止重试并说明，继续用文件工具；不得通过关闭保护、扩大权限或改用其他终端绕过故障。`
      : `# Local Command Environment
- On Windows, run_command executes via cmd.exe /d /s /c (not Bash/PowerShell): enclose paths in double quotes, use %NAME% / set "NAME=value" for variables, discard output with >nul 2>&1, chain with && (avoid semicolons, <<EOF, export, chmod, or sudo).
- For multi-line scripts, write them with write_file first, then invoke a verified interpreter; for PowerShell use powershell.exe -NoProfile -NonInteractive -File "script.ps1".
- If encountering SANDBOX_UNAVAILABLE or Cannot find the native Koffi module, it indicates a security component failure: stop retrying immediately, explain the issue, and continue using file tools; do not attempt to bypass it by disabling protection or switching terminals.`;
  }
  const sysName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  return isZh
    ? `# 本机命令环境
- 当前系统为 ${sysName}，run_command 通过 /bin/bash -lc 执行；优先用专用文件工具，调用额外解释器前先确认可用性。`
    : `# Local Command Environment
- Current system is ${sysName}. run_command executes via /bin/bash -lc. Prefer dedicated file tools, and verify interpreter availability before invocation.`;
}
