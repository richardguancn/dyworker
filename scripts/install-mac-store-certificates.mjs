// 仅安装用户明确授权、在本机生成并由苹果签发的三份 Mac 证书。
// 密码不进入 shell 文本或输出；源归档位于被忽略的 output/ 目录。
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('此操作只能在 macOS 上运行');
const folder = fileURLToPath(new URL('../output/mac-app-store-signing/', import.meta.url));
const password = readFileSync(path.join(folder, 'archive-password'), 'utf8');
const keychain = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
for (const kind of ['application', 'development', 'installer']) {
  const result = spawnSync('security', ['import', path.join(folder, `${kind}.p12`),
    '-k', keychain, '-f', 'pkcs12', '-P', password, '-T', kind === 'installer' ? '/usr/bin/productbuild' : '/usr/bin/codesign'],
  { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) {
    console.error(`${kind} 导入失败：${String(result.stderr || result.error?.message || '未知错误').trim()}`);
    process.exit(1);
  }
  console.log(`${kind}：已安装到本机钥匙串。`);
}
