import test from 'node:test';
import assert from 'node:assert/strict';
import { memberMentionAt, memberCandidates, insertMemberMention } from '../builtin-plugins/ds-bot/src/mentions.ts';
import { mentionsIn } from '../builtin-plugins/ds-bot/upstream/src/host/groups.js';
const members = [{ id: 'chief', name: '总管', role: '团队协调' }, { id: 'writer', name: '写手', role: '写作' }, { id: 'reviewer', name: '审核员', role: '审核' }];

test('@ 成员候选支持中文、角色搜索、光标位置，邮箱不弹出候选', () => {
  assert.deepEqual(memberMentionAt('请 @写 审核', 4), { start: 2, end: 4, query: '写' });
  assert.equal(memberMentionAt('user@example.com', 8), null);
  assert.equal(memberMentionAt('已选 @写手 ', 7), null);
  assert.equal(memberMentionAt('正文', 2), null);
  assert.deepEqual(memberCandidates(members, '写作').map(item => item.id), ['writer']);
  assert.deepEqual(memberCandidates(members, '').map(item => item.id), ['chief', 'writer', 'reviewer', '__all__']);
  assert.deepEqual(memberCandidates(members.slice(0, 1), '审核'), []);
});

test('选择成员保留光标后文字，生成的 @ 内容能被群聊正确识别', () => {
  const draft = '请 @写 检查后交给 @审核员';
  const result = insertMemberMention(draft, memberMentionAt(draft, 4), members[1]);
  assert.equal(result.text, '请 @写手  检查后交给 @审核员');
  assert.equal(result.caret, 6);
  assert.deepEqual(mentionsIn(result.text, members).found.map(item => item.id), ['writer', 'reviewer']);
  const all = memberCandidates(members, '').at(-1);
  assert.equal(mentionsIn(insertMemberMention('@', memberMentionAt('@', 1), all).text, members).all, true);
});
