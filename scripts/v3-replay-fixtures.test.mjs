import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(projectRoot, 'test-fixtures', 'v3');
const expectedScenarios = ['01', '02', '03', '04', '05', '06', '07'];

async function loadFixtures() {
  const names = (await readdir(fixtureDir)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(fixtureDir, name), 'utf8'))));
}

async function replayFixture(fixture) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `almaren-v3-${fixture.scenario}-`));
  const db = new Database(path.join(directory, 'replay.db'));
  try {
    db.exec(`
      CREATE TABLE "ReplayRun" ("scenario" TEXT PRIMARY KEY, "status" TEXT, "executionMode" TEXT, "completionDelivered" INTEGER);
      CREATE TABLE "ReplayTask" ("ref" TEXT PRIMARY KEY, "agentId" TEXT, "mode" TEXT, "status" TEXT, "sortOrder" INTEGER, "started" INTEGER);
      CREATE TABLE "ReplayEvent" ("sequence" INTEGER PRIMARY KEY, "type" TEXT, "taskRef" TEXT, "payload" TEXT);
      CREATE TABLE "ReplayArtifact" ("taskRef" TEXT, "path" TEXT, "change" TEXT, "valid" INTEGER);
    `);
    db.prepare('INSERT INTO "ReplayRun" VALUES (?, ?, ?, ?)').run(
      fixture.scenario,
      fixture.run.status,
      fixture.source.executionMode,
      fixture.run.completion?.messageDelivered ? 1 : 0
    );
    const insertTask = db.prepare('INSERT INTO "ReplayTask" VALUES (?, ?, ?, ?, ?, ?)');
    const insertEvent = db.prepare('INSERT INTO "ReplayEvent" VALUES (?, ?, ?, ?)');
    const insertArtifact = db.prepare('INSERT INTO "ReplayArtifact" VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const task of fixture.tasks) {
        insertTask.run(task.ref, task.agentId, task.mode, task.status, task.sortOrder, task.lifecycle.started ? 1 : 0);
      }
      for (const event of fixture.events) {
        insertEvent.run(event.sequence, event.type, event.taskRef, JSON.stringify(event.payload));
      }
      for (const manifest of fixture.manifests) {
        for (const entry of manifest.entries || []) {
          insertArtifact.run(manifest.taskRef, entry.path, entry.change, entry.valid === false ? 0 : 1);
        }
      }
    })();
    return {
      run: db.prepare('SELECT * FROM "ReplayRun"').get(),
      tasks: db.prepare('SELECT * FROM "ReplayTask" ORDER BY "sortOrder"').all(),
      events: db.prepare('SELECT * FROM "ReplayEvent" ORDER BY "sequence"').all(),
      artifacts: db.prepare('SELECT * FROM "ReplayArtifact" ORDER BY "path"').all(),
    };
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function firstSequence(events, type, taskRef = null) {
  return events.find((event) => event.type === type && (!taskRef || event.taskRef === taskRef))?.sequence || 0;
}

const fixtures = await loadFixtures();

test('V3 replay baseline contains all seven portable scenarios', () => {
  assert.deepEqual(fixtures.map((fixture) => fixture.scenario).sort(), expectedScenarios);
  for (const fixture of fixtures) {
    const serialized = JSON.stringify(fixture);
    assert.doesNotMatch(serialized, /\/Users\/|\/home\//);
    assert.doesNotMatch(serialized, /[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i);
  }
});

for (const fixture of fixtures) {
  test(`V3 scenario ${fixture.scenario} replays its accepted runtime trace`, async () => {
    const replay = await replayFixture(fixture);
    const expected = fixture.expectations;
    assert.equal(replay.run.status, expected.terminalStatus);
    assert.equal(Boolean(replay.run.completionDelivered), expected.completionMessageDelivered);
    assert.equal(replay.tasks.length, expected.taskCount);
    const executed = replay.tasks.filter((task) => task.started && task.status === 'COMPLETED');
    assert.equal(executed.length, expected.executedTaskCount);
    assert.deepEqual(executed.map((task) => task.agentId), expected.taskAgents);
    assert.deepEqual(executed.map((task) => task.mode), expected.taskModes);
    assert.deepEqual([...new Set(replay.artifacts.map((artifact) => artifact.path))].sort(), [...expected.artifactPaths].sort());
    assert.equal(replay.artifacts.every((artifact) => artifact.valid), true);
    assert.deepEqual(replay.events.map((event) => event.sequence), replay.events.map((_, index) => index + 1));
    assert.equal(replay.events.filter((event) => event.type.startsWith('WEB_')).length, expected.webEventCount);
    assert.equal(replay.events.filter((event) => event.type === 'TASK_DISPATCH_APPROVED').length, expected.dispatchApprovalCount || 0);
    assert.equal(replay.events.filter((event) => event.type === 'TASK_DISPATCH_REJECTED').length, expected.rejectedProposalCount || 0);
    const revised = replay.events.filter((event) => event.type === 'TASK_DISPATCH_APPROVED' && JSON.parse(event.payload)?.revised === true);
    assert.equal(revised.length, expected.revisedDispatchCount || 0);
    if (expected.artifactChanges) {
      assert.deepEqual([...new Set(replay.artifacts.map((artifact) => artifact.change))], expected.artifactChanges);
    }
    for (const task of replay.tasks.filter((item) => item.started)) {
      const started = firstSequence(replay.events, 'TASK_STARTED', task.ref);
      assert.ok(started > 0, `${task.ref} 缺少 TASK_STARTED`);
      if (replay.run.executionMode === 'REVIEW_DISPATCH') {
        const approved = firstSequence(replay.events, 'TASK_DISPATCH_APPROVED', task.ref);
        assert.ok(approved > 0 && approved < started, `${task.ref} 未在执行前完成派发审批`);
      }
    }
  });
}

test('scenario 06 rejects the first proposal and replans before any rejected work starts', () => {
  const fixture = fixtures.find((item) => item.scenario === '06');
  const rejectedTask = fixture.tasks.find((task) => task.status === 'CANCELLED');
  assert.ok(rejectedTask);
  assert.equal(rejectedTask.lifecycle.started, false);
  const rejected = firstSequence(fixture.events, 'TASK_DISPATCH_REJECTED', rejectedTask.ref);
  const nextProposal = fixture.events.find((event) => event.type === 'COORDINATOR_TASK_PROPOSED' && event.sequence > rejected);
  assert.ok(rejected > 0);
  assert.equal(nextProposal?.agentId, 'professional-product');
});

test('scenario 07 persists the revised dispatch fields used by the worker', () => {
  const fixture = fixtures.find((item) => item.scenario === '07');
  const task = fixture.tasks[0];
  assert.equal(task.title, '实现移动端库存盘点页面');
  assert.match(task.instruction, /只看有差异/);
  assert.match(task.acceptanceCriteria, /375px 宽度下没有横向滚动/);
  const approval = fixture.events.find((event) => event.type === 'TASK_DISPATCH_APPROVED');
  assert.equal(approval.payload.revised, true);
});
