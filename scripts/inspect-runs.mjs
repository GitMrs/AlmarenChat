import Database from 'better-sqlite3';

const db = new Database('dev.db');
const spaceId = '9e64daf5-67db-4637-b015-b909b7cd3b48';

const runs = db.prepare('SELECT id, status, input, createdAt, updatedAt FROM "AgentRun" WHERE spaceId = ? ORDER BY createdAt DESC').all(spaceId);
console.log('=== All Runs in Space ===');
console.log(JSON.stringify(runs, null, 2));

for (const r of runs) {
  const tasks = db.prepare('SELECT id, title, agentName, status, skillId, attempt, error, reviewDecision, reviewSummary, reviewFeedback, createdAt, updatedAt FROM "AgentTask" WHERE runId = ?').all(r.id);
  console.log(`\n--- Tasks for Run ${r.id} (${r.status}) ---`);
  console.log(JSON.stringify(tasks, null, 2));

  const events = db.prepare('SELECT id, type, message, createdAt FROM "AgentRunEvent" WHERE runId = ? ORDER BY createdAt DESC LIMIT 8').all(r.id);
  console.log(`\n--- Latest 8 Events for Run ${r.id} ---`);
  console.log(JSON.stringify(events, null, 2));
}

const messages = db.prepare('SELECT id, role, content, createdAt FROM "SpaceMessage" WHERE spaceId = ? ORDER BY createdAt DESC LIMIT 5').all(spaceId);
console.log('\n=== Latest 5 Messages ===');
console.log(JSON.stringify(messages, null, 2));
