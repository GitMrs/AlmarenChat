import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('automation publication keeps finalization, draft creation and publication as separate approval boundaries', async () => {
  const [lifecycle, finalizationRoute, connectorRuntime, page] = await Promise.all([
    readFile(path.join(root, 'worker/runtime/work-lifecycle-store.mjs'), 'utf8'),
    readFile(path.join(root, 'app/api/spaces/[spaceId]/actions/[actionId]/route.ts'), 'utf8'),
    readFile(path.join(root, 'worker/runtime/connector-action-runtime.mjs'), 'utf8'),
    readFile(path.join(root, 'app/spaces/[spaceId]/page.tsx'), 'utf8'),
  ]);
  assert.match(lifecycle, /completionAction: context\.completionAction/);
  assert.match(lifecycle, /'FINALIZE_WORK', 'MEDIUM'/);
  assert.match(finalizationRoute, /selectAutomatedWechatDraftFiles\(files, action\.workId\)/);
  assert.match(finalizationRoute, /kind: 'WECHAT_CREATE_DRAFT',[\s\S]{0,120}riskLevel: 'HIGH'/);
  assert.match(finalizationRoute, /automation-wechat-draft:/);
  assert.match(connectorRuntime, /'WECHAT_PUBLISH', 'HIGH',[\s\S]{0,80}'PENDING'/);
  assert.match(page, /确认创建草稿/);
  assert.match(page, /确认正式发布/);
});

test('operations dashboard is scoped to the authenticated space owner', async () => {
  const route = await readFile(path.join(root, 'app/api/spaces/[spaceId]/operations/route.ts'), 'utf8');
  assert.match(route, /where: \{ id: spaceId, userId \}/);
  assert.match(route, /createdAt: \{ gte: since \}/);
  assert.doesNotMatch(route, /payload:\s*true/);
});

test('automation deletion is recoverable and preserves execution history', async () => {
  const route = await readFile(path.join(root, 'app/api/spaces/[spaceId]/automations/[automationId]/route.ts'), 'utf8');
  assert.match(route, /data: \{ enabled: false, deletedAt: new Date\(\) \}/);
  assert.doesNotMatch(route, /spaceAutomation\.delete\(/);
});
