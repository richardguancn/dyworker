// 安装到 DYWorker 独立数据目录；不携带模型密钥，不修改其他插件。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const dataDir = process.env.DYWORKER_USER_DATA_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library/Application Support/DYWorker')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'DYWorker')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'DYWorker'));
const root = path.join(dataDir, 'qwenpaw'), runtime = path.join(root, 'runtime');
fs.mkdirSync(root, { recursive: true });
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}
const uv = process.env.DYWORKER_UV || 'uv';
run(uv, ['venv', '--python', process.env.DYWORKER_QWENPAW_PYTHON || '3.12', '--allow-existing', runtime]);
const python = path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
run(uv, ['pip', 'install', '--python', python, 'qwenpaw==2.2.1']);
run(python, ['-m', 'qwenpaw', 'init', '--defaults', '--accept-security'], {
  ...process.env, QWENPAW_WORKING_DIR: path.join(root, 'data'), QWENPAW_TELEMETRY_DISABLED: '1',
});
console.log(`QwenPaw 已安装：${root}`);
