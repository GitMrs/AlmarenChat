import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { reviewAcceptedTaskExperiences } from './agent-growth-review.mjs';
function setup() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE "AgentExperience" (id TEXT, userId TEXT, agentId TEXT, spaceId TEXT, runId TEXT, outcome TEXT, status TEXT, sourceType TEXT, title TEXT, summary TEXT, tags TEXT);
    CREATE TABLE "AgentGrowthEvent" (id TEXT, userId TEXT, agentId TEXT, spaceId TEXT, scope TEXT, type TEXT, sourceType TEXT, sourceId TEXT, eventKey TEXT UNIQUE, payload TEXT, createdAt TEXT);
    INSERT INTO "AgentExperience" VALUES ('e', 'u', 'agent', 's', 'r', 'ACCEPTED', 'ACTIVE', 'TASK', '整理资料', '资料包含过期资料，需要逐项核验日期', '[]');`);
  return db;
}
const run = { id: 'r', userId: 'u', spaceId: 's' };
test('no change is marked reviewed without generating growth; repeat skips model', async () => {
  const db = setup(); let calls = 0;
  const complete = async () => { calls++; return { content: '{"changed":false}' }; };
  await reviewAcceptedTaskExperiences(db, { run, complete, timestamp: 'now' });
  await reviewAcceptedTaskExperiences(db, { run, complete, timestamp: 'now' });
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM AgentGrowthEvent').get().n, 0);
  db.close();
});
test('evidenced reflection persists once and foreign evidence is rejected', async () => {
  const db = setup();
  const decision = { changed: true, type: 'REFLECTION', title: '核验日期', content: '整理时效性资料需要逐项核验日期', beliefKey: '资料时效', behaviorChange: '先检查发布日期', evidenceRefs: [{ type: 'experience', id: 'foreign' }] };
  const complete = async () => ({ content: JSON.stringify(decision) });
  await reviewAcceptedTaskExperiences(db, { run, complete, timestamp: 'now', warn() {} });
  assert.equal(db.prepare('SELECT tags FROM AgentExperience').get().tags, '[]');
  decision.evidenceRefs[0].id = 'e';
  await reviewAcceptedTaskExperiences(db, { run, complete, timestamp: 'now' });
  await reviewAcceptedTaskExperiences(db, { run, complete, timestamp: 'now' });
  const events = db.prepare('SELECT * FROM AgentGrowthEvent').all();
  assert.equal(events.length, 1);
  assert.equal(events[0].scope, 'SPACE');
  assert.equal(events[0].spaceId, 's');
  assert.equal(events[0].sourceId, 'e');
  db.close();
});
test('other spaces and unaccepted experiences do not trigger review', async () => {
  const db = setup();
  await reviewAcceptedTaskExperiences(db, { run: { ...run, spaceId: 'other' }, complete() { throw new Error('must not call'); }, timestamp: 'now' });
  db.prepare("UPDATE AgentExperience SET outcome = 'NEEDS_IMPROVEMENT'").run();
  let calls = 0;
  await reviewAcceptedTaskExperiences(db, { run, complete() { calls++; }, timestamp: 'now' });
  assert.equal(calls, 0);
  db.close();
});
test('experience edited during model request cannot generate stale growth', async () => {
  const db = setup();
  await reviewAcceptedTaskExperiences(db, { run, timestamp: 'now', complete: async () => {
    db.prepare("UPDATE AgentExperience SET summary = '用户纠正后的结果'").run();
    return { content: JSON.stringify({ changed: true, type: 'BELIEF', title: '日期判断', content: '需要核验日期', beliefKey: '日期', behaviorChange: '核验日期', evidenceRefs: [{ type: 'experience', id: 'e' }] }) };
  } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM AgentGrowthEvent').get().n, 0);
  assert.equal(db.prepare('SELECT tags FROM AgentExperience').get().tags, '[]');
  db.close();
});
