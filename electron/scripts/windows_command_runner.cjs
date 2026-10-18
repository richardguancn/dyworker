// 外层 runner 用 CRT 规则传 argv；cmd /c 的正文必须交给 Node 按 cmd 专用规则启动。
// base64 只用于无损传输命令，不改变权限；本程序及 cmd 均继承外层受限令牌与 Job。
const { spawn } = require('node:child_process');

if (process.platform !== 'win32') {
  process.stderr.write('dyworker-command-runner: requires Windows\n');
  process.exitCode = 127;
} else {
  try {
    const encoded = process.argv[2];
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('missing or invalid command');
    const command = Buffer.from(encoded, 'base64').toString('utf8');
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
      windowsVerbatimArguments: true, windowsHide: true, stdio: 'inherit',
    });
    child.on('error', error => {
      process.stderr.write(`dyworker-command-runner: ${error.message}\n`);
      process.exitCode = 127;
    });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  } catch (error) {
    process.stderr.write(`dyworker-command-runner: ${error.message}\n`);
    process.exitCode = 127;
  }
}
