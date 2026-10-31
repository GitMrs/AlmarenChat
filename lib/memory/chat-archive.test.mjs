import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectChatArchiveBatch, chatArchiveReferences, summarizeChatArchive,
  buildAssistantArchivePrompt, buildAgentArchivePrompt,
  normalizeAgentArchiveSummary, buildAgentArchiveFallback, normalizeChatArchiveSummary, buildChatArchiveFallback, limitChatArchiveBatch, CHAT_ARCHIVE_MAX_SOURCE_CHARS,
} from './chat-archive.mjs';
import { completeExperienceEntries, deterministicUserExperience } from '../personal-assistant/experience-context-policy.mjs';
import { formatAssistantHistoryTimestamp } from '../personal-assistant/history-context.mjs';

const messages = Array.from({ length: 64 }, (_, index) => ({
  id: `m-${index}`, role: index % 2 ? 'assistant' : 'user',
  content: index % 2 ? '建议先确认维修时间。' : '我预约了明天上午维修手机。',
  createdAt: new Date(Date.UTC(2026, 9, 30, 15, index)),
}));

test('automatic threshold and bounded manual batches retain recent messages', () => {
  assert.equal(selectChatArchiveBatch(messages.slice(0, 63), { automatic: true }).length, 0);
  assert.deepEqual(selectChatArchiveBatch(messages, { automatic: true }), messages.slice(0, 48));
  assert.deepEqual(selectChatArchiveBatch(messages, { preserveRecent: 4 }), messages.slice(0, 48));
  assert.deepEqual(selectChatArchiveBatch(messages, { preserveRecent: 0 }), messages.slice(0, 48));
  assert.deepEqual(selectChatArchiveBatch(messages.slice(0, 2), { preserveRecent: 4 }), []);
  assert.equal(messages.length, 64);
});

test('references retain exact ordered source IDs and original time boundaries', () => {
  const batch = selectChatArchiveBatch(messages, { automatic: true });
  const refs = chatArchiveReferences(batch);
  assert.deepEqual(refs.messageIds, batch.map(message => message.id));
  assert.equal(refs.messageCount, 48);
  assert.equal(refs.lastMessageId, 'm-47');
  assert.equal(refs.startAt, messages[0].createdAt);
  assert.equal(refs.endAt, messages[47].createdAt);
  assert.throws(() => chatArchiveReferences([]), /empty/);
});

test('assistant prompt keeps Beijing time, source labels and whole-entry normalization', async () => {
  const batch = messages.slice(0, 2);
  const policy = {
    buildPrompt: items => buildAssistantArchivePrompt(items, formatAssistantHistoryTimestamp),
    normalizeSummary: value => completeExperienceEntries(value || '', 6000),
    fallbackSummary: deterministicUserExperience,
  };
  const result = await summarizeChatArchive(batch, {
    ...policy,
    summarize: async prompt => {
      assert.match(prompt, /2026-10-30 23:00，北京时间/);
      assert.match(prompt, /助理说法，未独立核实/);
      assert.match(prompt, /当时计划，是否完成待确认/);
      return '- [用户陈述] 已预约维修。\n- [助理说法，未独立核实] 建议确认时间。';
    },
  });
  assert.equal(result, '- [用户陈述] 已预约维修。\n- [助理说法，未独立核实] 建议确认时间。');
  for (const summarize of [undefined, async () => '', async () => { throw new Error('timeout'); }]) {
    assert.equal(await summarizeChatArchive(batch, { ...policy, summarize }), deterministicUserExperience(batch));
  }
});

test('both roles share the same prompt, normalization and deterministic fallback', async () => {
  const policy = { buildPrompt: buildAgentArchivePrompt, normalizeSummary: normalizeAgentArchiveSummary, fallbackSummary: buildAgentArchiveFallback };
  assert.equal(await summarizeChatArchive(messages, policy), buildAgentArchiveFallback(messages));
  assert.match(buildAgentArchiveFallback(messages), /用户当时陈述/);
  assert.doesNotMatch(buildAgentArchiveFallback(messages), /建议先确认/);
  assert.ok(buildAgentArchiveFallback(messages).length <= 2000);
  assert.equal(buildAgentArchivePrompt(messages), buildAssistantArchivePrompt(messages, formatAssistantHistoryTimestamp));
  assert.equal(buildAgentArchiveFallback(messages), buildChatArchiveFallback(messages));
  const result = await summarizeChatArchive(messages, { ...policy, summarize: async prompt => {
    assert.match(prompt, /2026-10-30 23:00，北京时间/);
    assert.match(prompt, /助理说法，未独立核实/);
    return '- [用户陈述，2026-10-30 23:00，北京时间] 用户当时预约维修。';
  } });
  assert.equal(result, normalizeAgentArchiveSummary('- [用户陈述，2026-10-30 23:00，北京时间] 用户当时预约维修。'));
  for (const summarize of [async () => null, async () => ' ', async () => { throw new Error('offline'); }]) {
    assert.equal(await summarizeChatArchive(messages, { ...policy, summarize }), buildAgentArchiveFallback(messages));
  }
});


test('manual and automatic batches respect source size without skipping messages', () => {
  const source = messages.map(message => ({ ...message, content: '长'.repeat(5000) }));
  const batch = selectChatArchiveBatch(source, { automatic: true });
  assert.equal(batch.length, 4);
  assert.ok(batch.reduce((size, message) => size + message.content.length, 0) <= CHAT_ARCHIVE_MAX_SOURCE_CHARS);
  assert.deepEqual(limitChatArchiveBatch(source.slice(4)).map(message => message.id), source.slice(4, 8).map(message => message.id));
  const huge = { ...messages[0], content: '开头' + '长'.repeat(30000) + '结尾' };
  assert.deepEqual(limitChatArchiveBatch([huge, messages[1]]), [huge]);
  const prompt = buildAgentArchivePrompt([huge]);
  assert.match(prompt, /开头/);
  assert.match(prompt, /结尾/);
  assert.match(prompt, /中段已省略/);
  assert.match(prompt, /原消息ID：m-0/);
  assert.ok(prompt.length < 7000);
});

test('new model summaries require provenance and a timestamp from the source batch', async () => {
  const valid = '- [用户陈述，2026-10-30 23:00，北京时间] 已预约维修。';
  const invalid = '- 用户已经修好手机。\n- [用户陈述，2026-09-01 23:00，北京时间] 已完成维修。';
  assert.equal(normalizeChatArchiveSummary(valid + '\n' + invalid, messages), valid);
  assert.equal(normalizeChatArchiveSummary(invalid, messages), '');
  const summary = await summarizeChatArchive(messages, { summarize: async () => invalid });
  assert.equal(summary, buildChatArchiveFallback(messages));
  assert.doesNotMatch(summary, /已完成维修|已经修好/);
});
