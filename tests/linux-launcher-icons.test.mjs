import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LinuxTargetHelper } from 'app-builder-lib/out/targets/LinuxTargetHelper.js';
import { convertIcon } from 'app-builder-lib/out/util/iconConverter.js';
import { buildLinuxIcons, LINUX_ICON_SIZES } from '../scripts/build-linux-icons.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('真实打包器生成的菜单入口能对应到各常用尺寸的 PNG 图标', async t => {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-launcher-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  const packager = {
    projectDir: root, config: metadata.build, platformSpecificBuildOptions: metadata.build.linux,
    executableName: metadata.name, fileAssociations: [], info: { metadata },
    appInfo: { productName: metadata.productName, sanitizedProductName: metadata.productName,
      description: metadata.description },
    getDefaultFrameworkIcon: () => [],
    resolveIcon: async (sources, fallbackSources, format) =>
      (await convertIcon({ sources, fallbackSources, roots: [root], format, outDir })).icons,
  };
  const helper = new LinuxTargetHelper(packager);
  const icons = await helper.icons;
  assert.deepEqual(icons.map(icon => icon.size), LINUX_ICON_SIZES);
  const entry = await helper.computeDesktopEntry(metadata.build.linux);
  assert.match(entry, /^Icon=dyworker$/m);
  assert.match(entry, /^StartupWMClass=dyworker$/m);
  assert.equal(helper.getDesktopFileName(), 'dyworker');
  for (const icon of icons) {
    assert.equal(path.extname(icon.file), '.png');
    const bytes = await fs.readFile(icon.file);
    assert.equal(bytes.readUInt32BE(16), icon.size);
    assert.equal(bytes.readUInt32BE(20), icon.size);
  }
});

test('菜单图标与圆角原图一致；原图改变或产物损坏时检查不能通过', async t => {
  assert.equal((await buildLinuxIcons({ checkOnly: true })).changed, false);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-linux-icon-check-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, 'icon.png'), directory = path.join(temporary, 'icons');
  await fs.copyFile(path.join(root, 'build/icon.png'), source);
  await fs.cp(path.join(root, 'build/icons'), directory, { recursive: true });
  assert.equal((await buildLinuxIcons({ checkOnly: true, source, directory })).changed, false);
  await fs.appendFile(source, 'changed');
  await assert.rejects(buildLinuxIcons({ checkOnly: true, source, directory }), /与原图不一致/);
  await fs.copyFile(path.join(root, 'build/icon.png'), source);
  await fs.writeFile(path.join(directory, '48x48.png'), 'broken');
  await assert.rejects(buildLinuxIcons({ checkOnly: true, source, directory }), /图标缺失或与原图不一致/);
});
