import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('Linux 采样按父子关系统计，缺失的 PSS 和读写权限不记成零', async t => {
  // 采样脚本按 /proc 结构读取，并用 os.sysconf 取页大小与时钟频率，Windows 上没有这些接口；
  // POSIX 平台（含用 --proc-root 指向构造目录时的 macOS）都能真实跑通。
  if (process.platform === 'win32') return t.skip('采样脚本依赖 /proc 与 os.sysconf，仅 POSIX 平台可用');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-proc-'));
  const put = async (pid, ppid, name, pss) => {
    const parts = Array(22).fill('0');
    parts[0] = 'S'; parts[1] = String(ppid); parts[11] = '100'; parts[12] = '20'; parts[19] = '1000'; parts[21] = '50';
    const folder = path.join(dir, String(pid));
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'stat'), `${pid} (${name}) ${parts.join(' ')}`);
    if (pss !== null) {
      await fs.writeFile(path.join(folder, 'smaps_rollup'), `Rss: 200 kB\nPss: ${pss} kB\n`);
      await fs.writeFile(path.join(folder, 'io'), 'read_bytes: 100\nwrite_bytes: 200\n');
    }
  };
  await put(10, 1, 'DY Worker (main)', 100);
  await put(11, 10, 'renderer', 50);
  await put(12, 11, 'tool', null);
  await put(99, 1, 'unrelated', 5000);
  const script = path.resolve('scripts/sample-linux-performance.py');
  const output = execFileSync('python3', [script, '--pid', '10', '--proc-root', dir, '--samples', '2', '--interval', '0.1'], {encoding: 'utf8'});
  const [metadata, first, second] = output.trim().split('\n').map(JSON.parse);
  assert.equal(metadata.cpu_definition, '100% = 一个逻辑核');
  assert.deepEqual(first.processes.map(row => row.pid), [10, 11, 12]);
  assert.equal(first.totals.pss_bytes, null);
  assert.equal(first.processes[0].pss_bytes, 102400);
  assert.equal(first.processes[0].cpu_percent_one_core, null);
  assert.equal(second.totals.cpu_percent_one_core, 0);
  assert.equal(second.totals.write_bytes_delta, null);
  assert.equal(second.processes[1].write_bytes_delta, 0);
});

test('无效进程号失败退出，不产生误导性的零占用结果', t => {
  if (process.platform === 'win32') return t.skip('采样脚本依赖 /proc 与 os.sysconf，仅 POSIX 平台可用');
  assert.throws(() => execFileSync('python3', ['scripts/sample-linux-performance.py', '--pid', '-1'], {stdio: 'pipe'}), error => error.status !== 0);
});
