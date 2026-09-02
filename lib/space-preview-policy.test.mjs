import assert from 'node:assert/strict';
import test from 'node:test';
import { spacePreviewPolicy } from './space-preview-policy.mjs';

const options = { origin: 'https://app.example.com', token: 'preview-token' };

test('space preview blocks external images by default', () => {
  const policy = spacePreviewPolicy(options);
  assert.match(policy, /img-src https:\/\/app\.example\.com\/api\/space-previews\/preview-token\/ data: blob:/);
  assert.doesNotMatch(policy, /img-src[^;]+ https:/);
});

test('space preview can load HTTPS images without granting script network access', () => {
  const policy = spacePreviewPolicy({ ...options, externalImages: true });
  assert.match(policy, /img-src[^;]+ https:/);
  assert.match(policy, /connect-src https:\/\/app\.example\.com\/api\/space-previews\/preview-token\//);
  assert.doesNotMatch(policy, /connect-src[^;]+ https:/);
  assert.match(policy, /frame-src 'none'/);
});
