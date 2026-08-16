import assert from 'node:assert/strict';
import test from 'node:test';
import { needsWorkspaceWrite, taskRequiresWorkspaceWrite } from './workspace-write-intent.mjs';

test('negative workspace requirements remain read only', () => {
  assert.equal(needsWorkspaceWrite('本次只需要分析，不创建或修改文件。'), false);
  assert.equal(needsWorkspaceWrite('不读取或写入工作区文件'), false);
  assert.equal(needsWorkspaceWrite('阅读报告，但不要修改任何文件'), false);
  assert.equal(needsWorkspaceWrite('不要创建新的 HTML 页面'), false);
});

test('positive workspace requirements still permit writes', () => {
  assert.equal(needsWorkspaceWrite('在空间里创建一份黄金分析报告'), true);
  assert.equal(needsWorkspaceWrite('无需修改旧文件，但需要创建 index.html'), true);
  assert.equal(needsWorkspaceWrite('修改现有 index.html'), true);
});

test('task write intent requires an explicit file operation', () => {
  assert.equal(taskRequiresWorkspaceWrite('评审现有 index.html，并输出交互建议。'), false);
  assert.equal(taskRequiresWorkspaceWrite('不要修改 index.html，只分析当前结构。'), false);
  assert.equal(taskRequiresWorkspaceWrite('把产品规则写入 docs/ticket-list-spec.md。'), true);
  assert.equal(taskRequiresWorkspaceWrite('预期可验收产物：docs/ticket-list-spec.md'), true);
  assert.equal(taskRequiresWorkspaceWrite('创建一个可直接预览的 index.html 页面。'), true);
  assert.equal(taskRequiresWorkspaceWrite('创建一份工作区文件。'), true);
});
