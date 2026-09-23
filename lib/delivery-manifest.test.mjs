import assert from 'node:assert/strict';
import test from 'node:test';
import { findDeliveryArtifact, normalizeDeliveryManifest } from './delivery-manifest.mjs';

test('delivery manifest keeps only safe relative artifact paths', () => {
  const manifest = normalizeDeliveryManifest({
    artifacts: [
      { path: 'daily-report.md', role: 'report', share: true, renderTheme: 'editorial-handwritten' },
      { path: '../secret.txt', role: 'report', share: true },
      { path: 'C:/secret.txt', role: 'asset', share: true },
    ],
  });
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(findDeliveryArtifact(manifest, 'daily-report.md')?.share, true);
  assert.equal(findDeliveryArtifact(manifest, 'missing.md'), null);
});

test('unknown delivery roles are treated as source artifacts', () => {
  const manifest = normalizeDeliveryManifest({ artifacts: [{ path: 'notes.md', role: 'unknown', deliver: ['QQ'] }] });
  assert.deepEqual(manifest.artifacts[0], {
    path: 'notes.md', role: 'source', share: false, renderTheme: null, deliver: ['qq'],
  });
});
