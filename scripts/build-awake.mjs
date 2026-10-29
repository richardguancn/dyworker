import { spawn } from 'node:child_process';

// 只在本次构建期间阻止 macOS 空闲睡眠；屏幕仍可熄灭。
// -w 将有效期绑定到构建进程，意外退出时也由系统自动释放。
export async function keepBuildAwake({ platform = process.platform, pid = process.pid, spawnProcess = spawn } = {}) {
  if (platform !== 'darwin') return () => {};
  const child = spawnProcess('/usr/bin/caffeinate', ['-i', '-w', String(pid)], { stdio: 'ignore' });
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  } catch (error) {
    child.kill();
    throw new Error('无法在构建期间阻止自动睡眠，已停止构建', { cause: error });
  }
  child.unref();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    child.kill();
  };
}
