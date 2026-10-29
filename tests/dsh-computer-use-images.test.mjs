import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OfficialDshSession } from '../electron/host/dsh-runtime/full-session.mts';

test('电脑操作截图作为图片传递给模型并保存到任务记录', { timeout: 30000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dyw-cu-image-')));
  const profileDir = path.join(root, 'plugins'), workspacePath = path.join(root, 'workspace');
  await fs.mkdir(path.join(profileDir, 'node_modules'), { recursive: true });
  await fs.mkdir(workspacePath);
  await fs.writeFile(path.join(profileDir, 'package.json'), '{"name":"test-profile","private":true}');
  const name = 'plugin__dyworker_linux_computer_use__screenshot';
  const sharp = (await import('sharp')).default;
  const image = (await sharp({ create: { width: 3, height: 2, channels: 3, background: '#186a32' } }).png().toBuffer()).toString('base64');
  const requests = [];
  const runtime = new OfficialDshSession({ profileDir, dataDir: path.join(root, 'data'), workspacePath,
    sessionId: 'image-test', plugins: [], approve: async () => true,
    extraTools: [{ name, description: '屏幕截图', parameters: { type: 'object', properties: {} } }],
    onExtraTool: async () => ({ ok: true, result: '已截图', images: [{ data: image, mimeType: 'image/png' }] }),
    async *generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: 'capture', name, argumentsDelta: '{}' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'capture', name, arguments: '{}' } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'text-delta', index: 0, text: '看到了截图' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '看到了截图' } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    },
  });
  t.after(async () => { await runtime.close(); await fs.rm(root, { recursive: true, force: true }); });
  await runtime.start();
  const result = await runtime.request('prompt', { text: '查看屏幕' });
  assert.equal(requests.length, 2);
  assert.ok(requests[1].messages.some(message => message.role === 'tool' && message.content.some(block => block.type === 'image')), JSON.stringify({ messages: requests[1].messages, events: result.events.filter(e => e.type === 'tool/result') }));
  assert.ok(result.events.some(event => event.type === 'tool/result' && event.data.message.content.some(block => block.type === 'image')));
});
