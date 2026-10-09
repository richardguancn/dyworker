import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantImageAttachments } from '../src/assistantImages.ts';

test('助手图片保持实际出现顺序及字节大小，忽略工具图片、远程地址、普通文字和空图片', () => {
  const result = assistantImageAttachments({ executedMessages: [
    { role: 'tool', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } }] },
    { role: 'assistant', content: [{ type: 'text', text: 'data:image/png;base64,YQ==' },
      { type: 'image_url', image_url: { url: 'https://example.test/image.png' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,YWI=' } }] },
    { role: 'assistant', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' } },
      { type: 'image_url', image_url: { url: 'data:image/svg+xml;base64,YWJj' } },
      { type: 'image_url', image_url: { url: 'data:image/gif;base64,YWJj' } }] },
  ] });
  assert.deepEqual(result.map(image => image.size), [1, 2, 3]);
  assert.deepEqual(result.map(image => image.mimeType), ['image/png', 'image/jpeg', 'image/gif']);
  assert.ok(result.every(image => image.path === '' && image.isImage));
  assert.deepEqual(assistantImageAttachments({}), []);
});
