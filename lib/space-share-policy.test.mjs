import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidShareId, resolveSharedResource } from './space-share-policy.mjs';

test('accepts only generated share ids', () => {
  assert.equal(isValidShareId('a'.repeat(32)), true);
  assert.equal(isValidShareId('a'.repeat(31)), false);
  assert.equal(isValidShareId('../secret'), false);
});

test('serves the HTML entry and registered static resource paths', () => {
  assert.deepEqual(resolveSharedResource('workspace/index.html'), {
    relativePath: 'workspace/index.html',
    mimeType: 'text/html; charset=utf-8',
  });
  assert.deepEqual(resolveSharedResource('workspace/index.html', ['assets', 'app.js']), {
    relativePath: 'workspace/assets/app.js',
    mimeType: 'text/javascript; charset=utf-8',
  });
});

test('rejects traversal, documents, and additional HTML pages', () => {
  assert.equal(resolveSharedResource('workspace/index.html', ['..', 'secret.md']), null);
  assert.equal(resolveSharedResource('workspace/index.html', ['assets/../secret.js']), null);
  assert.equal(resolveSharedResource('workspace/index.html', ['notes.md']), null);
  assert.equal(resolveSharedResource('workspace/index.html', ['admin.html']), null);
});
