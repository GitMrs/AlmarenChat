import assert from 'node:assert/strict';
import test from 'node:test';
import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';
import { createPersonalMailClient, MAIL_TOOLS, validateMailCredentials, MAIL_PROVIDERS } from './personal-mail.mjs';
import { createConnectorClient } from './client.mjs';

const server = { url: 'connector:personal-mail', headers: { provider: 'qq', email: 'test@qq.com', password: 'secret-code' } };
function fixture(overrides = {}) {
  const calls = [];
  const metadata = { uid: 8, envelope: { subject: '邮件标题', from: [{ address: 'friend@example.test' }] }, flags: new Set(), size: 200 };
  const client = {
    on: () => {}, mailbox: { uidValidity: 123n, exists: 5 },
    connect: async () => calls.push('connect'),
    close: () => calls.push('close'),
    getMailboxLock: async (...args) => { calls.push(['lock', ...args]); return { release: () => calls.push('release') }; },
    search: async (...args) => { calls.push(['search', ...args]); return [1, 3, 5, 7, 8]; },
    fetch: async function* (...args) { calls.push(['fetch', ...args]); yield metadata; yield { ...metadata, uid: 7 }; },
    fetchOne: async (...args) => { calls.push(['fetchOne', ...args]); return args[1].source ? { source: Buffer.from('Subject: test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n邮件正文') } : metadata; },
    ...overrides,
  };
  const adapter = createPersonalMailClient(server, { clientFactory: options => { calls.push(['options', options]); return client; } });
  return { adapter, calls, client };
}

test('supported providers validate account domains and reject custom hosts, blank passwords and injected fields', () => {
  for (const [provider, config] of Object.entries(MAIL_PROVIDERS)) assert.equal(validateMailCredentials({ provider, email: `user@${config.domains[0]}`, password: 'code' }).provider, provider);
  for (const headers of [{ ...server.headers, email: 'user@evil.test' }, { ...server.headers, provider: '__proto__' }, { ...server.headers, password: '' }, { ...server.headers, host: 'localhost' }]) assert.throws(() => validateMailCredentials(headers), /完整邮箱地址/);
});

test('discovery is offline, while verify really connects with TLS and selects a read-only inbox', async () => {
  const { adapter, calls } = fixture();
  assert.deepEqual(await adapter.listTools(), MAIL_TOOLS);
  assert.deepEqual(calls, []);
  await adapter.verify();
  const options = calls[0][1];
  assert.equal(options.host, 'imap.qq.com'); assert.equal(options.port, 993); assert.equal(options.secure, true); assert.equal(options.logger, false);
  assert.deepEqual(calls[2], ['lock', 'INBOX', { readOnly: true }]);
  assert.deepEqual(calls.slice(-2), ['release', 'close']);
  assert.deepEqual(await createConnectorClient(server).listTools(), MAIL_TOOLS);
  // Verify the installed real client accepts these options, without connecting to a network.
  const real = new ImapFlow(options); real.close();
});

test('search returns newest UIDs with bounded pagination and forwards structured criteria', async () => {
  const { adapter, calls } = fixture();
  const result = await adapter.callTool('search_emails', { from: 'friend', since: '2026-11-01', before: '2026-11-14', unseen: true, limit: 2 });
  assert.equal(result.uidValidity, '123'); assert.equal(result.nextBeforeUid, 7);
  assert.deepEqual(result.emails.map(item => item.uid), [8, 7]);
  const search = calls.find(item => item[0] === 'search');
  assert.equal(search[1].seen, false); assert.equal(search[1].since.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.deepEqual(calls.find(item => item[0] === 'fetch').slice(1)[0], '8,7');
  await adapter.callTool('search_emails', { beforeUid: 7, uidValidity: '123' });
  assert.equal(calls.filter(item => item[0] === 'search').at(-1)[1].uid, '1:6');
  const empty = await adapter.callTool('search_emails', { beforeUid: 1, uidValidity: '123' });
  assert.deepEqual(empty.emails, []);
});

test('invalid criteria and stale UIDVALIDITY cannot fetch another message', async () => {
  const { adapter, calls } = fixture();
  for (const input of [{ limit: 21 }, { beforeUid: 7 }, { since: '2026-02-30' }, { text: 'a\r\nb' }, { raw: 'ALL' }]) await assert.rejects(adapter.callTool('search_emails', input));
  assert.equal(calls.length, 0);
  await assert.rejects(adapter.callTool('read_email', { uid: 8, uidValidity: '124' }), /标识已变化/);
  assert.ok(!calls.some(item => item[0] === 'fetchOne'));
  assert.deepEqual(calls.slice(-2), ['release', 'close']);
});

test('body parsing handles Chinese MIME, bounds text and never requests flags mutation', async () => {
  const { adapter, calls } = fixture();
  const result = await adapter.callTool('read_email', { uid: 8, uidValidity: '123' });
  assert.match(result.text, /邮件正文/); assert.equal(result.unseen, true);
  const fetches = calls.filter(item => item[0] === 'fetchOne');
  assert.equal(fetches.length, 2); assert.equal(fetches[1][2].source.maxLength, 2 * 1024 * 1024 + 1); assert.deepEqual(fetches[1][3], { uid: true });
  const f = fixture({ fetchOne: async () => ({ size: 3 * 1024 * 1024 }) });
  await assert.rejects(f.adapter.callTool('read_email', { uid: 8, uidValidity: '123' }), /超过2MB/);
  const bounded = createPersonalMailClient(server, { clientFactory: () => fixture().client, parseMail: async () => ({ text: 'x'.repeat(15000), attachments: [{ filename: 'a.txt', content: Buffer.from('secret'), size: 6 }] }) });
  const body = await bounded.callTool('read_email', { uid: 8, uidValidity: '123' });
  assert.equal(body.text.length, 12000); assert.equal(body.truncated, true); assert.equal(body.attachments[0].content, undefined);
  const parsed = await simpleParser(Buffer.from('Subject: =?UTF-8?B?5rWL6K+V?=\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>你好</p>'), { skipTextToHtml: true });
  assert.equal(parsed.subject, '测试'); assert.match(parsed.text, /你好/);
});

test('network/auth errors close the session and never return credentials or server transcripts', async () => {
  for (const error of [Object.assign(new Error('secret-code'), { authenticationFailed: true }), new Error('private server transcript')]) {
    const f = fixture({ connect: async () => { throw error; } });
    await assert.rejects(f.adapter.verify(), reason => { assert.doesNotMatch(reason.message, /secret-code|private server transcript/); return /邮箱/.test(reason.message); });
    assert.equal(f.calls.at(-1), 'close');
  }
});
