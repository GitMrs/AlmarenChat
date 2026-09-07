import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { cancelPiSpaceTurn, piSpacePaths, piToolActivity, piToolLabel, publicPiAssistantNote, visiblePiAssistantText } from './space-session.mjs';

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
