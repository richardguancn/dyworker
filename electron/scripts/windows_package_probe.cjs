// 使用打包后的 Electron、依赖和应用命令入口验收，不依赖开发机的 node_modules/PATH。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

async function main() {
  assert.equal(process.platform, 'win32');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dyworker-package-'));
  try {
    // 只调整本检查新建的目录；确保宿主原本有权写入，外部拒绝才具有验证意义。
    const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).match(/S-1-5-[0-9-]+/)?.[0];
    assert.ok(sid);
    execFileSync('icacls.exe', [root, '/grant', `*${sid}:(OI)(CI)M`], { stdio: 'pipe' });
    const work = path.join(root, '工作 目录');
    await fs.mkdir(work);
    const outside = path.join(root, 'outside.txt');
    await fs.writeFile(outside, 'original');
    const agent = path.resolve(__dirname, '../agent.mjs').replace(/([\\/])app\.asar\.unpacked([\\/])/, '$1app.asar$2');
    const { Workspace } = await import(pathToFileURL(agent).href);
    const workspace = new Workspace(work, { trustTempDirs: false });
    // 用应用自身的可执行文件运行已写入的脚本，不要求用户另装 Node。
    const script = path.join(work, '检查 脚本.cjs');
    await fs.writeFile(script, `require('node:fs').writeFileSync(process.argv[2], '你好'); process.stdout.write('PACKAGE_COMMAND_OK');`);
    const command = target => `"${process.execPath}" "${script}" "${target}"`;
    const success = await workspace.runCommand(command('结果.txt'));
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(success.protection.state, 'ready');
    assert.equal(await fs.readFile(path.join(work, '结果.txt'), 'utf8'), '你好');
    assert.match(success.output, /PACKAGE_COMMAND_OK/);
    const denied = await workspace.runCommand(command(outside));
    assert.equal(denied.errorCode, 'SANDBOX_DENIED', JSON.stringify(denied));
    assert.equal(await fs.readFile(outside, 'utf8'), 'original');
    const readonly = await workspace.runCommand(command('只读.txt'), { mode: 'read-only' });
    assert.equal(readonly.errorCode, 'SANDBOX_DENIED', JSON.stringify(readonly));
    await assert.rejects(fs.access(path.join(work, '只读.txt')), { code: 'ENOENT' });
    console.log('Windows package command protection verified');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
