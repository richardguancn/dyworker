import test from 'node:test';
import assert from 'node:assert/strict';
import { commandGuidance } from '../electron/host/command-guidance.mts';
import { systemPrompt } from '../electron/agent/prompt.mts';
import { toolDefinitions } from '../electron/agent/tool-definitions.mts';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { prepareCommandExecution, unpackedCommandPath } from '../electron/command-execution.mts';

test('Windows 模型上下文和命令工具明确使用 cmd，区分 PowerShell、Bash 与保护故障', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const prompt = systemPrompt('C:\\工作 目录');
    assert.ok(prompt.includes(commandGuidance('win32')));
    assert.match(prompt, /cmd\.exe \/d \/s \/c/);
    assert.match(prompt, /<<EOF/);
    assert.match(prompt, /powershell\.exe -NoProfile -NonInteractive -File/);
    assert.match(prompt, /SANDBOX_UNAVAILABLE.*Cannot find the native Koffi module/);
    assert.match(prompt, /不得通过关闭保护、扩大权限或改用其他终端绕过故障/);
    const command = toolDefinitions().find(tool => tool.function.name === 'run_command');
    assert.match(command.function.description, /Windows.*cmd\.exe/);
  } finally { Object.defineProperty(process, 'platform', original); }
});

test('macOS 和 Linux 命令环境保持 Bash，与 Windows 指引分开', () => {
  for (const platform of ['darwin', 'linux']) {
    const guidance = commandGuidance(platform);
    assert.match(guidance, /\/bin\/bash -lc/);
    assert.doesNotMatch(guidance, /cmd\.exe|powershell\.exe/);
  }
});

test('打包后的已识别 Windows 保护入口从物理目录启动，权限参数完整保留', async () => {
  const runner = path.resolve('测试 应用/resources/app.asar/node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js');
  const args = ['--workspace', 'C:\\工作 目录', '--temp', 'C:\\Temp', '--mode', 'read-only', '--', 'command'];
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === '@deepseek-ai/dsh-sandbox-windows-acl/runner') return { url: pathToFileURL(runner).href, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.includes('/dsh-sandbox-local/lib/index.js')) return { format: 'module', shortCircuit: true, source: `
        import { Service } from '@deepseek-ai/cordis';
        export default class extends Service {
          constructor(ctx) { super(ctx, 'sandbox'); }
          confine() { return { argv: [process.execPath, ${JSON.stringify(runner)}, ...${JSON.stringify(args)}],
            enforcement: 'partial', denialSignatures: ['Access is denied'],
            runnerFailureRules: [{ allowedExitCodes: [127], fatalSignatures: ['windows-acl-run: '] }] }; }
        }` };
      return next(url, context);
    },
  });
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const result = await prepareCommandExecution('unused', { workspacePath: 'C:\\工作 目录', mode: 'read-only' });
    assert.equal(result.argv[1], runner.replace('app.asar', 'app.asar.unpacked'));
    assert.deepEqual(result.argv.slice(2), args);
    assert.equal(result.enforcement, 'partial');
    assert.equal(unpackedCommandPath('C:\\Program Files\\app.asar\\node_modules\\runner.js'), 'C:\\Program Files\\app.asar.unpacked\\node_modules\\runner.js');
    assert.equal(unpackedCommandPath(result.argv[1]), result.argv[1]);
  } finally { hooks.deregister(); Object.defineProperty(process, 'platform', original); }
});
