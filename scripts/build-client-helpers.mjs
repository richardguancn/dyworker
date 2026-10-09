import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'src/pluginRuntime/vendor/dsh-dockkit');

// 官方普通 ESM 包与客户端插件 factory 的形态不同，在构建时转换，运行时不 eval。
export async function buildClientHelpers(checkOnly = false) {
  await buildInputHelpers(checkOnly);
  await buildDraftHelpers(checkOnly);
  await buildConversationImages(checkOnly);
  await buildConversationAssembly(checkOnly);
  await buildSessionController(checkOnly);
  await buildUiSession(checkOnly);
  await buildConnection(checkOnly);
  const result = await build({
    stdin: { contents: `export * from '@deepseek-ai/dsh-client-ui-dockkit';
      export { Tooltip as dyworkerTooltip } from './primitives/Tooltip.tsx';`, resolveDir: vendor, loader: 'js' },
    bundle: true, write: false, outfile: path.join(vendor, 'bundle.js'),
    platform: 'browser', format: 'cjs', target: 'es2022', minify: true,
    loader: { '.css': 'local-css' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'dyworker/primitives'],
    legalComments: 'none', logLevel: 'silent',
    plugins: [{ name: 'shared-primitives', setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'dock-primitives', namespace: 'dyworker' }));
      builder.onLoad({ filter: /.*/, namespace: 'dyworker' }, () => ({ loader: 'js', resolveDir: vendor, contents: `
        export { IconCloseFillRegular, IconCloseOutlineRegular, IconPanelLeftOutlineRegular, IconPlusOutlineRegular, Tooltip } from 'dyworker/primitives';
        export { MenuSurface } from './primitives/MenuSurface.tsx';
        export { focusWithoutRing } from './primitives/focus.ts';
        export { observeComposition } from './primitives/keyboard-composition.ts';
        export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]';
      ` }));
    } }],
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
  const output = `// 生成物：scripts/build-client-helpers.mjs；官方来源见 README.md。\nexport const dockkitStyles = ${JSON.stringify(css)};\nexport function createDockkitNamespace(require) {\n  const module = { exports: {} };\n  const exports = module.exports;\n${js}\n  return module.exports;\n}\n`;
  const target = path.join(vendor, 'index.js');
  let previous; try { previous = await readFile(target, 'utf8'); } catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方界面辅助模块产物过期，请运行 npm run build:plugins');
  await writeFile(target, output);
}

async function buildConnection(checkOnly) {
  const source=path.join(root,'vendor/dsh-connection');
  const target=path.join(root,'src/pluginRuntime/vendor/dsh-connection/index.js');
  const license=await readFile(path.join(source,'LICENSE'),'utf8');
  const result=await build({
    stdin:{contents:"export { ConnectionController } from './packages/client/connection/src/client/connection.ts';",resolveDir:source,loader:'ts'},
    bundle:true,write:false,outfile:target,platform:'browser',format:'esm',target:'es2022',
    legalComments:'inline',banner:{js:`/*!\n${license}\n*/`},logLevel:'silent',
  });
  const output='// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-connection/README.md。\n'+result.outputFiles[0].text;
  let previous;try{previous=await readFile(target,'utf8');}catch{}
  if(previous===output)return;
  if(checkOnly)throw new Error('官方连接恢复模块产物过期，请运行 npm run build:plugins');
  await writeFile(target,output);
}

async function buildUiSession(checkOnly) {
  const source = path.join(root, 'vendor/dsh-ui-session');
  const target = path.join(root, 'src/pluginRuntime/vendor/dsh-ui-session/index.js');
  const license = await readFile(path.join(source, 'LICENSE'), 'utf8');
  const result = await build({
    stdin: {contents: `export { UiSession } from './packages/client/ui-session/src/client/index.ts';
      export { SlotRegistry } from './packages/client/ui-renderer/src/client/registry.ts';`, resolveDir: source, loader: 'ts'},
    bundle: true, write: false, outfile: target, platform: 'browser', format: 'esm', target: 'es2022',
    jsx: 'automatic', external: ['@deepseek-ai/cordis', 'react', 'react/jsx-runtime'],
    alias: {'@deepseek-ai/dsh-client-ui-slots': path.join(source, 'packages/client/ui-slots/src/index.ts'),
      '@deepseek-ai/dsh-util-values': path.join(source, 'packages/util/values/src/index.ts')},
    legalComments: 'inline', banner: {js: `/*!\n${license}\n*/`}, logLevel: 'silent',
  });
  const output = '// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-ui-session/README.md。\n' + result.outputFiles[0].text;
  let previous; try {previous = await readFile(target, 'utf8');} catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方会话界面服务产物过期，请运行 npm run build:plugins');
  await writeFile(target, output);
}

async function buildSessionController(checkOnly) {
  const source = path.join(root, 'vendor/dsh-session-controller');
  const license = await readFile(path.join(source, 'LICENSE'), 'utf8');
  const gateway = path.join(source, 'packages/api/gateway/src/client');
  const gatewayIndex = await readFile(path.join(gateway, 'index.ts'), 'utf8');
  const classifier = gatewayIndex.match(/export function isRemoteFailure\(error: unknown\): error is RemoteFailure \{\n[^}]+\}/)?.[0];
  if (!classifier) throw new Error('固定官方 Gateway 失败识别函数缺失');
  const commands=await readFile(path.join(source,'packages/api/session-controller/src/commands.ts'),'utf8');
  const forkBoundary=commands.match(/function latestCompletedPrefixBoundary\(events: readonly SessionEvent\[\]\): SessionSeq \| undefined \{\n[\s\S]+?\n\}/)?.[0];
  if(!forkBoundary)throw new Error('固定官方完整回合分叉边界函数缺失');
  const clientTarget = path.join(root, 'src/pluginRuntime/vendor/dsh-session-controller/index.js');
  const outputs = [
    {target:clientTarget,platform:'browser',contents:`export { Session } from './packages/api/session-controller/src/client/sessions/session.ts';
      export { SessionManager } from './packages/api/session-controller/src/client/sessions/manager.ts';
      export { ClientSessions } from './packages/api/session-controller/src/client/sessions/service.ts';
      export { scopeOf } from './packages/api/session-controller/src/client/scope.ts';
      export { createSessionControlStream } from './packages/api/session-controller/src/client/transport.ts';
      export { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
      export { RemoteStream } from './packages/api/gateway/src/client/remote-stream.ts';
      export { RemoteStreamCarrierError } from './packages/api/gateway/src/client/stream-client.ts';`},
    {target:path.join(root,'electron/host/dsh-runtime/vendor/session-history.mjs'),platform:'node',contents:`export { SessionHistoryController } from './packages/api/session-controller/src/history.ts';
      export { SessionControlController } from './packages/api/session-controller/src/control.ts';
      export { ApiSessionList } from './packages/api/session-controller/src/list.ts';
      export { subagentCatalogProjectionDefinition } from './packages/subagent/subagent/src/catalog.ts';
      export { subagentIdentityProjectionDefinition } from './packages/subagent/subagent/src/projection.ts';
      export { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
      export ${forkBoundary}`},
  ];
  for (const output of outputs) {
    const result = await build({
      stdin:{contents:output.contents,resolveDir:source,loader:'ts'},bundle:true,write:false,outfile:output.target,
      platform:output.platform,format:'esm',target:'es2022',legalComments:'inline',logLevel:'silent',
      external:output.platform==='node' ? ['@deepseek-ai/cordis','@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-query','@deepseek-ai/dsh-subagent','@deepseek-ai/dsh-typert-protocol','@deepseek-ai/dsh-llm','zod'] : ['@deepseek-ai/cordis'],
      alias:{'@deepseek-ai/dsh-deque':path.join(source,'packages/util/deque/src/index.ts'),
        '@deepseek-ai/dsh-util-workspace-path':path.join(source,'packages/util/workspace-path/src/index.ts')},
      banner:{js:`/*!\n${license}\n*/`},
      plugins:[{name:'original-gateway-session-primitives',setup(builder) {
        builder.onResolve({filter:/^@deepseek-ai\/dsh-api-gateway\/client$/},()=>({path:'session-primitives',namespace:'fixed-gateway'}));
        builder.onLoad({filter:/.*/,namespace:'fixed-gateway'},()=>({resolveDir:gateway,loader:'ts',contents:`
          import { remoteErrorOf, type RemoteFailure } from '@deepseek-ai/dsh-typert-protocol';
          ${classifier}
          export { RemoteJournalStream } from './journal-stream.ts';
          export { RemoteSnapshotStream } from './snapshot-stream.ts';
          export { RemoteStreamCarrierError } from './stream-client.ts';`}));
      }}],
    });
    const js='// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-session-controller/README.md。\n'+result.outputFiles[0].text;
    let previous;try{previous=await readFile(output.target,'utf8');}catch{}
    if (previous===js) continue;
    if (checkOnly) throw new Error('官方会话历史模块产物过期，请运行 npm run build:plugins');
    await writeFile(output.target,js);
  }
}

async function buildConversationAssembly(checkOnly) {
  const source = path.join(root, 'vendor/dsh-conversation-assembly');
  const target = path.join(root, 'src/pluginRuntime/vendor/dsh-conversation-assembly/index.js');
  const license = await readFile(path.join(source, 'LICENSE'), 'utf8');
  const result = await build({
    stdin: { contents: `export { UiConversation } from './packages/client/ui-conversation/src/client/conversation/assembly.ts';
      export { MutableSessionEventSource } from './packages/api/session-controller/src/client/contract/events.ts';`, resolveDir: source, loader: 'ts' },
    bundle: true, write: false, outfile: target, platform: 'browser', format: 'esm', target: 'es2022',
    external: ['@deepseek-ai/cordis'], legalComments: 'inline',
    banner: {js: `/*!\n${license}\n*/`}, logLevel: 'silent',
  });
  const output = '// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-conversation-assembly/README.md。\n' + result.outputFiles[0].text;
  let previous; try { previous = await readFile(target, 'utf8'); } catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方会话装配模块产物过期，请运行 npm run build:plugins');
  await writeFile(target, output);
}

async function buildConversationImages(checkOnly) {
  const source = path.join(root, 'vendor/dsh-conversation-images');
  const target = path.join(root, 'src/pluginRuntime/vendor/dsh-conversation-images/index.js');
  const license = await readFile(path.join(source, 'LICENSE'), 'utf8');
  const result = await build({
    entryPoints: [path.join(source, 'historical-images.ts')], bundle: true, write: false,
    outfile: target, platform: 'browser', format: 'esm', target: 'es2022',
    external: ['@deepseek-ai/cordis'], legalComments: 'inline',
    banner: {js: `/*!\n${license}\n*/`}, logLevel: 'silent',
  });
  const output = '// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-conversation-images/README.md。\n' + result.outputFiles[0].text;
  let previous; try { previous = await readFile(target, 'utf8'); } catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方会话图片模块产物过期，请运行 npm run build:plugins');
  await writeFile(target, output);
}

async function buildDraftHelpers(checkOnly) {
  const source = path.join(root, 'vendor/dsh-draft-editor');
  const target = path.join(root, 'src/pluginRuntime/vendor/dsh-draft-editor/index.js');
  const license = await readFile(path.join(source, 'LICENSE'), 'utf8');
  const result = await build({
    stdin: { contents: `export { DraftEditorRuntime } from './input/editor/runtime.ts';
      export { SessionInputShell } from './input/facade.ts';
      export { ComposerBlockRegistry } from './input/blocks.ts';
      export { ConversationController } from './service.ts';
      export { DecoratorPortals } from './input/editor/DecoratorPortals.tsx';
      export { $composerLayout, detectOffsetOfClipboardOffset } from './input/editor/projection.ts';
      export { $selectDetectSpan } from './input/editor/span-map.ts';
      export { $isReferenceChipNode } from './input/editor/chip-node.tsx';`, resolveDir: path.join(source, 'src/client'), loader: 'ts' },
    bundle: true, write: false, outfile: target, platform: 'browser', format: 'esm', target: 'es2022',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lexical', '@lexical/*', '@deepseek-ai/cordis'],
    loader: { '.css': 'local-css' }, jsx: 'automatic', legalComments: 'inline', banner: { js: `/*!\n${license}\n*/` }, logLevel: 'silent',
    plugins: [{ name: 'reference-icons', setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'reference-icons', namespace: 'dyworker' }));
      builder.onLoad({ filter: /.*/, namespace: 'dyworker' }, () => ({ loader: 'jsx', contents: `import React from 'react';
        export function ReferenceIconRegular({ kind, size = 14, className }) {
          const paths = { file: 'M6 2h7l5 5v15H6z M13 2v6h5', folder: 'M2 5h8l2 3h10v12H2z', session: 'M3 3h18v14H8l-5 4z' };
          return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={paths[kind] || paths.file}/></svg>;
        }` }));
    } }],
  });
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const output = '// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-draft-editor/README.md。\n'
    + `export const draftEditorStyles = ${JSON.stringify(css)};\n` + result.outputFiles.find(file => file.path.endsWith('.js')).text;
  let previous; try { previous = await readFile(target, 'utf8'); } catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方草稿编辑器产物过期，请运行 npm run build:plugins');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, output);
}

async function buildInputHelpers(checkOnly) {
  const source = path.join(root, 'vendor/dsh-input-controller');
  const result = await build({
    stdin: { contents: "export { InputTriggerController } from './client/controller.ts'; export { detectTrigger } from './core/detect.ts';", resolveDir: path.join(source, 'src'), loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', format: 'esm', target: 'es2022', external: ['react'], legalComments: 'inline',
    logLevel: 'silent', plugins: [{ name: 'fixed-reference-grammar', setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-file-reference\/grammar$/ }, () => ({ path: path.join(source, 'src/grammar.ts') }));
    } }],
  });
  const output = '// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-input-controller/README.md。\n' + result.outputFiles[0].text;
  const target = path.join(root, 'src/pluginRuntime/vendor/dsh-input-controller/index.js');
  let previous; try { previous = await readFile(target, 'utf8'); } catch {}
  if (previous === output) return;
  if (checkOnly) throw new Error('官方输入控制器产物过期，请运行 npm run build:plugins');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, output);
}
