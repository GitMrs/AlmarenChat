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

test('space preview allows only trusted CDNs when external dependencies are enabled', () => {
  const policy = spacePreviewPolicy({ ...options, externalDependencies: true });
  assert.match(policy, /script-src[^;]+ https:\/\/cdn\.jsdelivr\.net/);
  assert.match(policy, /script-src[^;]+ https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(policy, /style-src[^;]+ https:\/\/unpkg\.com/);
  assert.match(policy, /font-src[^;]+ https:\/\/esm\.sh/);
  assert.doesNotMatch(policy, /script-src[^;]+ https:(?:\s|;)/);
  assert.doesNotMatch(policy, /connect-src[^;]+cdn\.jsdelivr\.net/);
});
