import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseNextGroupChatSpeaker, groupChatTurnLimit, nextGroupChatPosition } from './group-chat-scheduler.mjs';

const participants = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];

test('starts with the first participant and rotates fairly', () => {
  assert.equal(chooseNextGroupChatSpeaker({ participants, transcript: [] }).id, 'a');
  assert.equal(chooseNextGroupChatSpeaker({ participants, transcript: [{ agentId: 'a', content: '我先说说。' }] }).id, 'b');
  assert.equal(chooseNextGroupChatSpeaker({ participants, transcript: [
    { agentId: 'a', content: '我先说说。' },
    { agentId: 'b', content: '我补充一点。' },
  ] }).id, 'c');
});

test('routes a direct question to the addressed participant', () => {
  assert.equal(chooseNextGroupChatSpeaker({
    participants,
    transcript: [{ agentId: 'a', content: 'B，你怎么看这个想法？' }],
  }).id, 'b');
});

test('does not let the previous speaker immediately take another turn', () => {
  assert.equal(chooseNextGroupChatSpeaker({
    participants,
    transcript: [
      { agentId: 'a', content: '第一句' },
      { agentId: 'b', content: '第二句' },
      { agentId: 'a', content: '第三句' },
    ],
  }).id, 'c');
});

test('tracks the next cycle and turn limit', () => {
  const result = nextGroupChatPosition({ participants, transcript: [
    { agentId: 'a', content: '1' },
    { agentId: 'b', content: '2' },
    { agentId: 'c', content: '3' },
  ] });
  assert.equal(result.currentRound, 2);
  assert.equal(result.agent.id, 'a');
  assert.equal(groupChatTurnLimit({ participantCount: 3, maxRounds: 2 }), 6);
});
