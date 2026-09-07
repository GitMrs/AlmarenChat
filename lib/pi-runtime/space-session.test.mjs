import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  cancelPiSpaceTurn,
  compactSuccessfulPiMutationArguments,
  isolatePiMultiReplyContext,
  normalizePiCoordinationRequest,
  piSpacePaths,
  piToolActivity,
  piToolLabel,
  publicPiAssistantNote,
  requestPiSkillApproval,
  resolvePiSkillApproval,
  visiblePiAssistantText,
} from './space-session.mjs';

const executableSkill = {
  id: 'space:reports',
  name: 'Reports',
  digest: 'digest-1',
  execution: { scripts: ['tools/analyze.py'] },
};

const coordinationAgents = [
  { id: 'product', name: '产品' },
  { id: 'frontend', name: '前端' },
];

test('Pi coordination keeps only available members and runs a single round', () => {
  assert.deepEqual(normalizePiCoordinationRequest({
    mode: 'discussion',
    topic: '讨论甜粽还是咸粽',
    participantIds: ['product', 'missing', 'frontend', 'product'],
    rounds: 8,
  }, coordinationAgents), {
    mode: 'discussion',
    topic: '讨论甜粽还是咸粽',
    participantIds: ['product', 'frontend'],
    rounds: 1,
  });
});

test('Pi coordination rejects requests without valid members', () => {
  assert.equal(normalizePiCoordinationRequest({
    mode: 'broadcast', topic: '请大家介绍自己', participantIds: ['product'], rounds: 2,
  }, coordinationAgents).rounds, 1);
  assert.throws(() => normalizePiCoordinationRequest({
    mode: 'discussion', topic: '讨论', participantIds: ['missing'],
  }, coordinationAgents), /至少需要一位普通成员/);
});

test('Pi space paths keep project files and private sessions separate', () => {
  const paths = piSpacePaths({ projectRoot: 'C:\\app', userId: 'user-1', spaceId: 'space-1' });
  assert.equal(paths.workspaceRoot, path.resolve('C:\\app', 'data', 'spaces', 'user-1', 'space-1', 'workspace'));
  assert.equal(paths.sessionDir, path.resolve('C:\\app', 'data', 'spaces', 'user-1', 'space-1', '.runtime', 'pi', 'sessions'));
  assert.equal(paths.sessionDir.startsWith(paths.workspaceRoot + path.sep), false);
});

test('Pi space paths reject unsafe identifiers', () => {
  assert.throws(
    () => piSpacePaths({ projectRoot: 'C:\\app', userId: '..', spaceId: 'space-1' }),
    /格式不安全/
  );
  assert.throws(
    () => piSpacePaths({ projectRoot: 'C:\\app', userId: 'user-1', spaceId: '../outside' }),
    /格式不安全/
  );
});

test('cancelling an idle Pi space is a no-op', async () => {
  assert.equal(await cancelPiSpaceTurn('idle-space'), false);
});

test('Pi Skill approval is scoped to its user and space', async () => {
  let requested;
  const waiting = requestPiSkillApproval({
    userId: 'user-1',
    spaceId: 'space-approval',
    skill: executableSkill,
    script: 'tools/analyze.py',
    paths: ['docs/input.md'],
    onRequired: (approval) => { requested = approval; },
  });
  assert.equal(resolvePiSkillApproval({
    approvalId: requested.id, userId: 'user-2', spaceId: 'space-approval', approved: true,
  }), false);
  assert.equal(resolvePiSkillApproval({
    approvalId: requested.id, userId: 'user-1', spaceId: 'other-space', approved: true,
  }), false);
  assert.equal(resolvePiSkillApproval({
    approvalId: requested.id, userId: 'user-1', spaceId: 'space-approval', approved: true,
  }), true);
  assert.deepEqual(await waiting, { approved: true, reason: 'approved' });
});

test('cancelling Pi rejects and clears a pending Skill approval', async () => {
  let requested;
  const waiting = requestPiSkillApproval({
    userId: 'user-1',
    spaceId: 'space-cancel',
    skill: executableSkill,
    script: 'tools/analyze.py',
    paths: ['docs/input.json'],
    onRequired: (approval) => { requested = approval; },
  });
  assert.equal(await cancelPiSpaceTurn('space-cancel'), true);
  assert.deepEqual(await waiting, { approved: false, reason: 'cancelled' });
  assert.equal(resolvePiSkillApproval({
    approvalId: requested.id, userId: 'user-1', spaceId: 'space-cancel', approved: true,
  }), false);
});

test('Pi Skill approval expires and cannot be confirmed later', async () => {
  let requested;
  const waiting = requestPiSkillApproval({
    userId: 'user-1',
    spaceId: 'space-timeout',
    skill: executableSkill,
    script: 'tools/analyze.py',
    paths: ['docs/input.txt'],
    timeoutMs: 10,
    onRequired: (approval) => { requested = approval; },
  });
  const result = await waiting;
  assert.deepEqual(result, { approved: false, reason: 'timeout' });
  assert.equal(resolvePiSkillApproval({
    approvalId: requested.id, userId: 'user-1', spaceId: 'space-timeout', approved: true,
  }), false);
});

test('Pi rejects unsafe Skill script and input paths before requesting approval', () => {
  assert.throws(() => requestPiSkillApproval({
    userId: 'user-1', spaceId: 'space-1', skill: executableSkill,
    script: '../analyze.py', paths: ['docs/input.md'],
  }), /脚本未获批准或路径不安全/);
  assert.throws(() => requestPiSkillApproval({
    userId: 'user-1', spaceId: 'space-1', skill: executableSkill,
    script: 'tools/analyze.py', paths: ['../secret.md'],
  }), /Skill 输入必须/);
});

test('Pi tool activity keeps safe relative paths and drops tool contents', () => {
  assert.deepEqual(piToolActivity({
    id: 'call-1',
    name: 'write_file',
    args: { path: 'docs/index.html', content: '<secret>' },
    at: '2026-09-07T00:00:00.000Z',
  }), {
    id: 'call-1',
    name: 'write_file',
    label: '写入文件',
    target: 'docs/index.html',
    status: 'running',
    startedAt: '2026-09-07T00:00:00.000Z',
  });
  assert.equal(piToolActivity({ name: 'read_file', args: { path: 'C:\\secret\\key.txt' } }).target, undefined);
  assert.equal(piToolActivity({ name: 'patch_file', args: { path: '../secret', search: 'key' } }).target, undefined);
});

test('Pi exposes only the final assistant turn as chat text', () => {
  assert.equal(visiblePiAssistantText({
    role: 'assistant',
    content: [
      { type: 'text', text: '先说明一下，然后开始修改。' },
      { type: 'toolCall', id: 'call-1', name: 'write_file', arguments: {} },
    ],
  }), '');
  assert.equal(visiblePiAssistantText({
    role: 'assistant',
    content: [{ type: 'text', text: '文件已经修改并检查完成。' }],
  }), '文件已经修改并检查完成。');
});

test('Pi reports a safe action while tool arguments are still being prepared', () => {
  assert.equal(piToolLabel('write_file'), '写入文件');
  assert.equal(piToolLabel('check_files'), '检查文件');
  assert.equal(piToolLabel('unknown_tool'), '执行工具');
  assert.deepEqual(piToolActivity({
    id: 'search-1',
    name: 'web_search',
    args: { query: '  Next.js   最新版本  ' },
    at: '2026-09-07T00:00:00.000Z',
  }), {
    id: 'search-1',
    name: 'web_search',
    label: '联网搜索',
    target: 'Next.js 最新版本',
    status: 'running',
    startedAt: '2026-09-07T00:00:00.000Z',
  });
});

test('Pi keeps public pre-tool notes separate and redacts common credentials', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'text', text: '我会先调整结构，再写文件。密钥 sk-secret123456 不应展示。' },
      { type: 'toolCall', id: 'call-1', name: 'write_file', arguments: {} },
    ],
  };
  assert.equal(publicPiAssistantNote(message), '我会先调整结构，再写文件。密钥 [已隐藏密钥] 不应展示。');
  assert.equal(visiblePiAssistantText(message), '');
  assert.equal(publicPiAssistantNote({ role: 'assistant', content: [{ type: 'text', text: '最终答复' }] }), '');
});

test('Pi omits large arguments after a file mutation succeeds without changing stored messages', () => {
  const content = '<main>页面</main>'.repeat(1000);
  const messages = [
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'write-1', name: 'write_file', arguments: { path: 'index.html', content } }],
    },
    {
      role: 'toolResult', toolCallId: 'write-1', toolName: 'write_file', isError: false,
      content: [{ type: 'text', text: '{"ok":true}' }],
    },
  ];
  const original = structuredClone(messages);

  const compacted = compactSuccessfulPiMutationArguments(messages);

  assert.deepEqual(messages, original);
  assert.notEqual(compacted, messages);
  assert.equal(compacted[0].content[0].id, 'write-1');
  assert.equal(compacted[0].content[0].arguments.path, 'index.html');
  assert.match(compacted[0].content[0].arguments.content, new RegExp(`${content.length} 个字符已省略`));
  assert.deepEqual(compacted[1], messages[1]);
});

test('Pi keeps failed, pending, and small file mutation arguments available for correction', () => {
  const largeContent = 'x'.repeat(13000);
  const messages = [
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'failed', name: 'write_file', arguments: { path: 'failed.txt', content: largeContent } },
        { type: 'toolCall', id: 'pending', name: 'write_file', arguments: { path: 'pending.txt', content: largeContent } },
        { type: 'toolCall', id: 'small', name: 'write_file', arguments: { path: 'small.txt', content: 'small' } },
      ],
    },
    { role: 'toolResult', toolCallId: 'failed', toolName: 'write_file', isError: true, content: [] },
    { role: 'toolResult', toolCallId: 'small', toolName: 'write_file', isError: false, content: [] },
  ];

  assert.deepEqual(compactSuccessfulPiMutationArguments(messages), messages);
});

test('Pi omits large successful patch text while preserving patch structure', () => {
  const search = 'before'.repeat(1100);
  const replacement = 'after'.repeat(1400);
  const messages = [
    {
      role: 'assistant',
      content: [{
        type: 'toolCall', id: 'patch-1', name: 'patch_file',
        arguments: { path: 'src/app.js', search, replacement, replaceAll: true },
      }],
    },
    { role: 'toolResult', toolCallId: 'patch-1', toolName: 'patch_file', isError: false, content: [] },
  ];

  const args = compactSuccessfulPiMutationArguments(messages)[0].content[0].arguments;
  assert.equal(args.path, 'src/app.js');
  assert.equal(args.replaceAll, true);
  assert.match(args.search, new RegExp(`${search.length} 个字符已省略`));
  assert.match(args.replacement, new RegExp(`${replacement.length} 个字符已省略`));
});

test('Pi multi-reply agents share the context from before the current reply batch', () => {
  const base = { role: 'user', content: '之前的问题' };
  const question = { role: 'user', content: '@产品 @前端 介绍自己' };
  const firstReply = { role: 'assistant', content: [{ type: 'text', text: '我是产品。' }] };
  const messages = [base, question, firstReply, structuredClone(question)];

  assert.deepEqual(isolatePiMultiReplyContext(messages, 1), [base, question]);
  assert.deepEqual(messages, [base, question, firstReply, question]);
});

test('Pi multi-reply context removes only the requested number of matching turns', () => {
  const question = { role: 'user', content: '@三位成员 请回答' };
  const messages = [
    { role: 'assistant', content: [{ type: 'text', text: '更早的上下文' }] },
    question,
    { role: 'assistant', content: [{ type: 'text', text: '成员一' }] },
    structuredClone(question),
    { role: 'assistant', content: [{ type: 'text', text: '成员二' }] },
    structuredClone(question),
  ];

  assert.deepEqual(isolatePiMultiReplyContext(messages, 2), [messages[0], messages[5]]);
  assert.equal(isolatePiMultiReplyContext(messages, 0), messages);
});
