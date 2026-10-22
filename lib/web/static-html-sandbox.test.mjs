import assert from 'node:assert/strict';
import test from 'node:test';
import { STATIC_HTML_SANDBOX } from './static-html-sandbox.mjs';

test('static HTML enables low-risk interactions without origin or navigation privileges', () => {
  const permissions = new Set(STATIC_HTML_SANDBOX.split(/\s+/));
  assert.deepEqual(permissions, new Set([
    'allow-scripts',
    'allow-forms',
    'allow-modals',
    'allow-downloads',
  ]));
  assert.equal(permissions.has('allow-same-origin'), false);
  assert.equal(permissions.has('allow-popups'), false);
  assert.equal(permissions.has('allow-top-navigation'), false);
});
