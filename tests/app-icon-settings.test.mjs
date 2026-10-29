import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultAppearance } from '../electron/appearance.mts';

const require = createRequire(import.meta.url);
const sourceUrl = new URL('../src/appearance/AppearanceSettingsPanel.tsx', import.meta.url);
const source = fs.readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
const js = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

for (const platform of ['linux', 'win32', 'darwin']) {
  test(`${platform} 外观页面显示图标选择和已保存的选项`, () => {
    const exports = {};
    const controller = {
      useAppearanceStore: () => ({ saved: { ...defaultAppearance(), dockIcon: 'light' },
        capabilities: { platform, backdropFilter: true, systemBackdrop: { available: false } } }),
      useResolvedTheme: () => 'dark',
    };
    vm.runInNewContext(js, { exports, URL, require: name => name === './controller' ? controller :
      name === './tokens' ? require('../src/appearance/tokens.ts') : require(name) });
    const html = renderToStaticMarkup(createElement(exports.AppearanceSettingsPanel));
    const title = platform === 'darwin' ? 'Dock 图标' : '应用图标';
    assert.match(html, new RegExp(`aria-label="浅色 ${title}"[^>]*aria-checked="true"`));
    assert.match(html, new RegExp(`aria-label="深色 ${title}"[^>]*aria-checked="false"`));
    assert.ok(html.includes(platform === 'darwin' ? 'dock-light.png' : 'icon-light.png'));
    if (platform !== 'darwin') assert.ok(html.includes('启动器和固定快捷方式的图标由安装包提供'));
  });
}
