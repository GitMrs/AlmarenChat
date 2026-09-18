import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWebhookTemplate } from '../../lib/webhook-template.mjs';

const payload = {
  event: 'space.automation.completed',
  content: { title: '每日速报', text: '今天有 3 条内容', markdown: '**每日速报**' },
  run: { status: 'COMPLETED' },
};

test('webhook JSON templates replace nested values without executing code', () => {
  assert.deepEqual(renderWebhookTemplate({
    msg_type: 'text',
    content: { text: '{{content.title}}\n{{content.text}}', status: '{{run.status}}' },
  }, payload), {
    msg_type: 'text',
    content: { text: '每日速报\n今天有 3 条内容', status: 'COMPLETED' },
  });
});

test('webhook templates keep exact object values as JSON values', () => {
  assert.deepEqual(renderWebhookTemplate({ raw: '{{content}}', missing: '{{content.unknown}}' }, payload), {
    raw: payload.content,
    missing: '',
  });
});
