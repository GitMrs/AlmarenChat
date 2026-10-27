import assert from 'node:assert/strict';
import test from 'node:test';
import { getReasoningDelta, getMessageReasoning, withMessageReasoning } from './reasoning.mjs';

test('extracts only provider reasoning strings and never substitutes answer content', () => {
  assert.equal(getReasoningDelta({ reasoning_content: '思考', reasoning: '别名' }), '思考');
  assert.equal(getReasoningDelta({ reasoning: '别名' }), '别名');
  assert.equal(getReasoningDelta({ reasoning: {}, content: '正文' }), '');
  assert.equal(getReasoningDelta(undefined), '');
});

test('reasoning metadata survives storage alongside images and retrieval sources', () => {
  const attachments = [{ type: 'image', url: '/test.png' }, { type: 'retrieval', records: [] }];
  const saved = JSON.parse(JSON.stringify(withMessageReasoning(attachments, '思考')));
  assert.equal(getMessageReasoning(saved), '思考');
  assert.deepEqual(saved.slice(0, 2), attachments);
  assert.equal(attachments.length, 2);
  assert.equal(getMessageReasoning(withMessageReasoning(saved, '替换')), '替换');
  assert.deepEqual(withMessageReasoning(saved, ''), attachments);
});

test('messages without reasoning keep their existing attachment storage', () => {
  assert.equal(withMessageReasoning(null, '  '), undefined);
  assert.equal(getMessageReasoning(undefined), '');
  assert.equal(getMessageReasoning([{ type: 'reasoning', content: {} }]), '');
});
