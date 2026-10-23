import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadBuilderToolset } from 'app-builder-lib/out/util/electronGet.js';

// The same pinned, checksum-verified toolset as electron-builder. Always embed
// Windows x64, even when the installer is compiled on another host platform.
const directory = await downloadBuilderToolset({
  releaseName: '7zip@1.0.0', filenameWithExt: '7zip-win-x64.tar.gz',
  checksums: { '7zip-win-x64.tar.gz': 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3' },
  githubOrgRepo: 'electron-userland/electron-builder-binaries',
});
const executable = path.join(directory, 'bin', '7za.exe');
const header = await fs.open(executable);
try {
  const bytes = Buffer.alloc(2);
  await header.read(bytes, 0, 2, 0);
  assert.equal(bytes.toString(), 'MZ', '安装包必须内置 Windows 解压程序');
} finally { await header.close(); }
const quote = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const definitions = [
  ['DYW_WINDOWS_7ZA', executable],
  ['DYW_7ZIP_LICENSE', path.join(directory, 'LICENSE.txt')],
  ['DYW_7ZIP_COPYING', path.join(directory, 'COPYING')],
];
for (const [, file] of definitions) await fs.access(file);
const destination = path.resolve(process.argv[2]);
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, definitions.map(([name, value]) => `!define ${name} "${quote(value)}"`).join('\n') + '\n');
