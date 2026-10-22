import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isReviewerProtectedPath, planTaskApproval } from '../electron/agent.mts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('拆出的代理模块保留原有人工审批边界，读取与相似目录不受影响', () => {
  const modules = readdirSync(new URL('../electron/agent/', import.meta.url)).filter(file => file.endsWith('.mts'));
  assert.ok(modules.length > 0);
  for (const file of modules) {
    for (const name of [file, file.replace(/\.mts$/, '.mjs')]) {
      const target = path.join('electron', 'agent', name);
      assert.equal(isReviewerProtectedPath(root, target), true, target);
      for (const approvalMode of ['reviewer', 'full-access']) {
        assert.equal(planTaskApproval({ workspacePath: root, name: 'write_file', args: { path: target }, approvalMode }), 'confirm', target);
      }
      assert.equal(planTaskApproval({ workspacePath: root, name: 'read_file', args: { path: target }, approvalMode: 'full-access' }), 'execute', target);
    }
  }
  assert.equal(isReviewerProtectedPath(root, 'electron/agent-notes/review.mts'), false);
  assert.equal(isReviewerProtectedPath(root, 'electron/agent/../unrelated.mts'), false);
});
