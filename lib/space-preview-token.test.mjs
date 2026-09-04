import assert from 'node:assert/strict';
import test from 'node:test';
import { signSpacePreviewToken, verifySpacePreviewToken } from './space-preview-token.mjs';

test('space preview token keeps a valid read-only scope', () => {
  const token = signSpacePreviewToken({
    userId: 'user-1', spaceId: 'space-1', root: 'space', externalImages: true, externalDependencies: true,
  });
  const payload = verifySpacePreviewToken(token);
  assert.equal(payload.userId, 'user-1');
  assert.equal(payload.spaceId, 'space-1');
  assert.equal(payload.root, 'space');
  assert.equal(payload.externalImages, true);
  assert.equal(payload.externalDependencies, true);
});

test('space preview does not grant external resources unless explicitly requested', () => {
  const token = signSpacePreviewToken({ userId: 'user-1', spaceId: 'space-1', root: 'space' });
  assert.equal(verifySpacePreviewToken(token).externalImages, false);
  assert.equal(verifySpacePreviewToken(token).externalDependencies, false);
});

test('space preview token rejects tampering and incomplete staging scope', () => {
  const token = signSpacePreviewToken({ userId: 'user-1', spaceId: 'space-1', root: 'staging' });
  assert.equal(verifySpacePreviewToken(token), null);
  assert.equal(verifySpacePreviewToken(`${token}x`), null);
});
