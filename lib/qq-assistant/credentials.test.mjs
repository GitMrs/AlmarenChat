import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptQQCredential, encryptQQCredential, isValidInternalQQSecret } from './credentials.mjs';

const secret = 'a-secure-test-secret-that-is-longer-than-32-characters';

test('QQ credentials round-trip without exposing plaintext', () => {
  const encrypted = encryptQQCredential('secret-value', secret);
  assert.equal(encrypted.includes('secret-value'), false);
  assert.equal(decryptQQCredential(encrypted, secret), 'secret-value');
});

test('QQ credential ciphertext cannot be decrypted with another key', () => {
  const encrypted = encryptQQCredential('secret-value', secret);
  assert.throws(() => decryptQQCredential(encrypted, `${secret}-different`));
});

test('internal QQ secret comparison rejects missing and different secrets', () => {
  assert.equal(isValidInternalQQSecret(secret, secret), true);
  assert.equal(isValidInternalQQSecret('different', secret), false);
  assert.equal(isValidInternalQQSecret('', secret), false);
});
