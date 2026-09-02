import 'dotenv/config';
import path from 'node:path';
import Database from 'better-sqlite3';

function resolveDatabasePath() {
  const url = (process.env.DATABASE_URL || 'file:./dev.db').replace(/^['"]|['"]$/g, '');
  if (!url.startsWith('file:')) throw new Error('Agent Runtime 第一阶段仅支持 SQLite DATABASE_URL');
  return path.resolve(process.cwd(), url.slice('file:'.length));
}

const db = new Database(resolveDatabasePath());
db.pragma('foreign_keys = ON');

function hasTable(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().some((item) => item.name === column);
}

function hasIndex(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(name));
}

try {
  if (!hasTable('User') || !hasTable('Agent')) {
    throw new Error('未找到基础表；全新数据库请先执行 prisma migrate deploy');
  }

  db.transaction(() => {
    if (!hasColumn('User', 'imageModelEnabled')) db.exec(`ALTER TABLE "User" ADD COLUMN "imageModelEnabled" BOOLEAN NOT NULL DEFAULT false`);
    if (!hasColumn('User', 'imageModelName')) db.exec('ALTER TABLE "User" ADD COLUMN "imageModelName" TEXT');
    if (!hasColumn('User', 'imageModelSize')) db.exec(`ALTER TABLE "User" ADD COLUMN "imageModelSize" TEXT DEFAULT '1024x1024'`);
    if (!hasColumn('Conversation', 'kind')) db.exec(`ALTER TABLE "Conversation" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'AGENT'`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS "PersonalAssistantProfile" (
        "userId" TEXT NOT NULL PRIMARY KEY,
        "conversationId" TEXT NOT NULL,
        "name" TEXT NOT NULL DEFAULT '小伴',
        "avatar" TEXT,
        "identity" TEXT,
        "soul" TEXT,
        "greeting" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "PersonalAssistantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "PersonalAssistantProfile_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AssistantMemoryItem" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'preference',
        "content" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "sourceMessageId" TEXT,
        "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "AssistantMemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE INDEX IF NOT EXISTS "Conversation_userId_kind_updatedAt_idx" ON "Conversation"("userId", "kind", "updatedAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "PersonalAssistantProfile_conversationId_key" ON "PersonalAssistantProfile"("conversationId");
      CREATE INDEX IF NOT EXISTS "AssistantMemoryItem_userId_status_updatedAt_idx" ON "AssistantMemoryItem"("userId", "status", "updatedAt");
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS "Space" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "instructions" TEXT,
        "executionMode" TEXT NOT NULL DEFAULT 'REVIEW_DISPATCH',
        "hostAgentId" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Space_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    if (!hasColumn('Space', 'hostAgentId')) db.exec('ALTER TABLE "Space" ADD COLUMN "hostAgentId" TEXT');
    if (!hasColumn('Space', 'instructions')) db.exec('ALTER TABLE "Space" ADD COLUMN "instructions" TEXT');
    if (!hasColumn('Space', 'executionMode')) db.exec(`ALTER TABLE "Space" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'REVIEW_DISPATCH'`);

    db.exec(`
      CREATE TABLE IF NOT EXISTS "SpaceMember" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "roleName" TEXT,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "SpaceMessage" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "speakerAgentId" TEXT,
        "content" TEXT NOT NULL,
        "attachments" JSONB,
        "sourceKey" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SpaceMessage_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "SpaceFile" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "mimeType" TEXT,
        "size" INTEGER,
        "relativePath" TEXT NOT NULL,
        "runId" TEXT,
        "taskId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'READY',
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME,
        CONSTRAINT "SpaceFile_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentRun" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "input" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "result" TEXT,
        "error" TEXT,
        "retryOfId" TEXT,
        "attempt" INTEGER NOT NULL DEFAULT 1,
        "workerId" TEXT,
        "heartbeatAt" DATETIME,
        "completionId" TEXT,
        "modelRequestCount" INTEGER NOT NULL DEFAULT 0,
        "modelRequestLimit" INTEGER NOT NULL DEFAULT 12,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        CONSTRAINT "AgentRun_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentTask" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "agentName" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "instruction" TEXT NOT NULL,
        "mode" TEXT NOT NULL DEFAULT 'executor',
        "dependsOn" JSONB,
        "skillId" TEXT NOT NULL DEFAULT 'general-task',
        "skillVersion" TEXT NOT NULL DEFAULT '1.0.0',
        "skillSnapshot" JSONB,
        "webResearchRequired" BOOLEAN NOT NULL DEFAULT false,
        "modelRequestCount" INTEGER NOT NULL DEFAULT 0,
        "modelRequestLimit" INTEGER NOT NULL DEFAULT 8,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "result" TEXT,
        "error" TEXT,
        "reviewFeedback" TEXT,
        "waitQuestion" TEXT,
        "waitReason" TEXT,
        "waitAnswer" TEXT,
        "waitingAt" DATETIME,
        "attempt" INTEGER NOT NULL DEFAULT 1,
        "sortOrder" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        "reviewedAt" DATETIME,
        CONSTRAINT "AgentTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentRunEvent" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "payload" JSONB,
        "idempotencyKey" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentRunOutbox" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "claimedBy" TEXT,
        "claimedAt" DATETIME,
        "deliveredAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "AgentRunOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentArtifactManifest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "attempt" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'BASELINED',
        "baseline" JSONB NOT NULL,
        "entries" JSONB,
        "validation" JSONB,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "completedAt" DATETIME,
        CONSTRAINT "AgentArtifactManifest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "AgentArtifactManifest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentSession" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "agentId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'IDLE',
        "currentTaskId" TEXT,
        "worklog" TEXT,
        "summary" TEXT,
        "lastActiveAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "AgentCoordinatorTurn" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "triggerEventId" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "inputSnapshot" JSONB,
        "action" JSONB,
        "error" TEXT,
        "modelRequestCount" INTEGER NOT NULL DEFAULT 0,
        "claimedBy" TEXT,
        "claimedAt" DATETIME,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "AgentCoordinatorTurn_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentTaskCompletion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "taskId" TEXT NOT NULL,
        "attempt" INTEGER NOT NULL,
        "workerId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "report" TEXT NOT NULL,
        "evidence" JSONB,
        "artifacts" JSONB,
        "validation" JSONB,
        "idempotencyKey" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentTaskCompletion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "AgentTaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "AgentRuntimeOutbox" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "runId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "aggregateId" TEXT NOT NULL,
        "idempotencyKey" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "claimedBy" TEXT,
        "claimedAt" DATETIME,
        "deliveredAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "AgentRuntimeOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "SpaceDiscussion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "spaceId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "topic" TEXT NOT NULL,
        "participantIds" JSONB NOT NULL,
        "transcript" JSONB,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "currentRound" INTEGER NOT NULL DEFAULT 1,
        "currentIndex" INTEGER NOT NULL DEFAULT 0,
        "maxRounds" INTEGER NOT NULL DEFAULT 2,
        "allowWeb" BOOLEAN NOT NULL DEFAULT false,
        "webSearchCount" INTEGER NOT NULL DEFAULT 0,
        "pendingResearch" JSONB,
        "researchContext" TEXT,
        "result" TEXT,
        "error" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        CONSTRAINT "SpaceDiscussion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "SpaceDiscussion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE TABLE IF NOT EXISTS "SpaceMemory" (
        "spaceId" TEXT NOT NULL PRIMARY KEY,
        "recentActivity" JSONB NOT NULL,
        "rollingSummary" TEXT,
        "historySummary" TEXT,
        "activityCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "SpaceMemory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS "Space_userId_updatedAt_idx" ON "Space"("userId", "updatedAt");
      CREATE INDEX IF NOT EXISTS "SpaceMember_spaceId_sortOrder_idx" ON "SpaceMember"("spaceId", "sortOrder");
      CREATE INDEX IF NOT EXISTS "SpaceMember_agentId_idx" ON "SpaceMember"("agentId");
      CREATE UNIQUE INDEX IF NOT EXISTS "SpaceMember_spaceId_agentId_key" ON "SpaceMember"("spaceId", "agentId");
      CREATE INDEX IF NOT EXISTS "SpaceMessage_spaceId_createdAt_idx" ON "SpaceMessage"("spaceId", "createdAt");
      CREATE INDEX IF NOT EXISTS "SpaceMessage_speakerAgentId_idx" ON "SpaceMessage"("speakerAgentId");
      CREATE INDEX IF NOT EXISTS "SpaceFile_spaceId_idx" ON "SpaceFile"("spaceId");
      CREATE INDEX IF NOT EXISTS "AgentRun_spaceId_createdAt_idx" ON "AgentRun"("spaceId", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentTask_runId_sortOrder_idx" ON "AgentTask"("runId", "sortOrder");
      CREATE INDEX IF NOT EXISTS "AgentTask_status_idx" ON "AgentTask"("status");
      CREATE INDEX IF NOT EXISTS "AgentRunEvent_runId_createdAt_idx" ON "AgentRunEvent"("runId", "createdAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunOutbox_runId_key" ON "AgentRunOutbox"("runId");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunOutbox_idempotencyKey_key" ON "AgentRunOutbox"("idempotencyKey");
      CREATE INDEX IF NOT EXISTS "AgentRunOutbox_status_availableAt_idx" ON "AgentRunOutbox"("status", "availableAt");
      CREATE INDEX IF NOT EXISTS "AgentRunOutbox_claimedBy_claimedAt_idx" ON "AgentRunOutbox"("claimedBy", "claimedAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentArtifactManifest_taskId_attempt_key" ON "AgentArtifactManifest"("taskId", "attempt");
      CREATE INDEX IF NOT EXISTS "AgentArtifactManifest_runId_createdAt_idx" ON "AgentArtifactManifest"("runId", "createdAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentSession_spaceId_agentId_key" ON "AgentSession"("spaceId", "agentId");
      CREATE INDEX IF NOT EXISTS "AgentSession_spaceId_status_idx" ON "AgentSession"("spaceId", "status");
      CREATE INDEX IF NOT EXISTS "AgentSession_currentTaskId_idx" ON "AgentSession"("currentTaskId");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentCoordinatorTurn_runId_triggerEventId_key" ON "AgentCoordinatorTurn"("runId", "triggerEventId");
      CREATE INDEX IF NOT EXISTS "AgentCoordinatorTurn_status_createdAt_idx" ON "AgentCoordinatorTurn"("status", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentCoordinatorTurn_claimedBy_claimedAt_idx" ON "AgentCoordinatorTurn"("claimedBy", "claimedAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentTaskCompletion_taskId_attempt_key" ON "AgentTaskCompletion"("taskId", "attempt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentTaskCompletion_idempotencyKey_key" ON "AgentTaskCompletion"("idempotencyKey");
      CREATE INDEX IF NOT EXISTS "AgentTaskCompletion_runId_createdAt_idx" ON "AgentTaskCompletion"("runId", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentTaskCompletion_taskId_active_idx" ON "AgentTaskCompletion"("taskId", "active");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRuntimeOutbox_idempotencyKey_key" ON "AgentRuntimeOutbox"("idempotencyKey");
      CREATE INDEX IF NOT EXISTS "AgentRuntimeOutbox_status_availableAt_idx" ON "AgentRuntimeOutbox"("status", "availableAt");
      CREATE INDEX IF NOT EXISTS "AgentRuntimeOutbox_runId_kind_createdAt_idx" ON "AgentRuntimeOutbox"("runId", "kind", "createdAt");
      CREATE INDEX IF NOT EXISTS "AgentRuntimeOutbox_claimedBy_claimedAt_idx" ON "AgentRuntimeOutbox"("claimedBy", "claimedAt");
      CREATE INDEX IF NOT EXISTS "SpaceDiscussion_spaceId_createdAt_idx" ON "SpaceDiscussion"("spaceId", "createdAt");
      CREATE INDEX IF NOT EXISTS "SpaceDiscussion_userId_createdAt_idx" ON "SpaceDiscussion"("userId", "createdAt");
      CREATE INDEX IF NOT EXISTS "SpaceDiscussion_status_createdAt_idx" ON "SpaceDiscussion"("status", "createdAt");
      UPDATE "Space" SET "hostAgentId" = 'space-coordinator' WHERE "hostAgentId" IS NULL;
    `);
    if (!hasColumn('SpaceFile', 'runId')) db.exec('ALTER TABLE "SpaceFile" ADD COLUMN "runId" TEXT');
    if (!hasColumn('SpaceFile', 'taskId')) db.exec('ALTER TABLE "SpaceFile" ADD COLUMN "taskId" TEXT');
    if (!hasColumn('SpaceFile', 'status')) db.exec(`ALTER TABLE "SpaceFile" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY'`);
    if (!hasColumn('SpaceFile', 'updatedAt')) db.exec('ALTER TABLE "SpaceFile" ADD COLUMN "updatedAt" DATETIME');
    if (!hasColumn('SpaceFile', 'shareId')) db.exec('ALTER TABLE "SpaceFile" ADD COLUMN "shareId" TEXT');
    if (!hasColumn('SpaceFile', 'shareEnabled')) db.exec(`ALTER TABLE "SpaceFile" ADD COLUMN "shareEnabled" BOOLEAN NOT NULL DEFAULT false`);
    if (!hasColumn('SpaceFile', 'sharedAt')) db.exec('ALTER TABLE "SpaceFile" ADD COLUMN "sharedAt" DATETIME');
    if (!hasColumn('AgentTask', 'reviewFeedback')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "reviewFeedback" TEXT');
    if (!hasColumn('AgentTask', 'waitQuestion')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "waitQuestion" TEXT');
    if (!hasColumn('AgentTask', 'waitReason')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "waitReason" TEXT');
    if (!hasColumn('AgentTask', 'waitAnswer')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "waitAnswer" TEXT');
    if (!hasColumn('AgentTask', 'waitingAt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "waitingAt" DATETIME');
    if (!hasColumn('AgentTask', 'attempt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1');
    if (!hasColumn('AgentTask', 'reviewedAt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "reviewedAt" DATETIME');
    if (!hasColumn('AgentTask', 'mode')) db.exec(`ALTER TABLE "AgentTask" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'executor'`);
    if (!hasColumn('AgentTask', 'dependsOn')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "dependsOn" JSONB');
    if (!hasColumn('AgentTask', 'skillId')) db.exec(`ALTER TABLE "AgentTask" ADD COLUMN "skillId" TEXT NOT NULL DEFAULT 'general-task'`);
    if (!hasColumn('AgentTask', 'skillVersion')) db.exec(`ALTER TABLE "AgentTask" ADD COLUMN "skillVersion" TEXT NOT NULL DEFAULT '1.0.0'`);
    if (!hasColumn('AgentTask', 'skillSnapshot')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "skillSnapshot" JSONB');
    if (!hasColumn('AgentTask', 'webResearchRequired')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "webResearchRequired" BOOLEAN NOT NULL DEFAULT false');
    if (!hasColumn('AgentTask', 'modelRequestCount')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "modelRequestCount" INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('AgentTask', 'modelRequestLimit')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "modelRequestLimit" INTEGER NOT NULL DEFAULT 8');
    if (!hasColumn('AgentRun', 'workerId')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "workerId" TEXT');
    if (!hasColumn('AgentRun', 'heartbeatAt')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "heartbeatAt" DATETIME');
    if (!hasColumn('AgentRun', 'completionId')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "completionId" TEXT');
    if (!hasColumn('AgentRun', 'modelRequestCount')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "modelRequestCount" INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('AgentRun', 'modelRequestLimit')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "modelRequestLimit" INTEGER NOT NULL DEFAULT 12');
    if (!hasColumn('AgentRun', 'runtimeVersion')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "runtimeVersion" INTEGER NOT NULL DEFAULT 1');
    if (!hasColumn('AgentRun', 'eventSequence')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "eventSequence" INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('AgentRun', 'coordinatorState')) db.exec('ALTER TABLE "AgentRun" ADD COLUMN "coordinatorState" JSONB');
    if (!hasColumn('AgentTask', 'acceptanceCriteria')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "acceptanceCriteria" TEXT');
    if (!hasColumn('AgentTask', 'origin')) db.exec(`ALTER TABLE "AgentTask" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'legacy_plan'`);
    if (!hasColumn('AgentTask', 'parentTaskId')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "parentTaskId" TEXT');
    if (!hasColumn('AgentTask', 'proposedAt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "proposedAt" DATETIME');
    if (!hasColumn('AgentTask', 'approvedAt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "approvedAt" DATETIME');
    if (!hasColumn('AgentTask', 'submittedAt')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "submittedAt" DATETIME');
    if (!hasColumn('AgentTask', 'reviewDecision')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "reviewDecision" TEXT');
    if (!hasColumn('AgentTask', 'reviewSummary')) db.exec('ALTER TABLE "AgentTask" ADD COLUMN "reviewSummary" TEXT');
    if (!hasColumn('AgentRunEvent', 'idempotencyKey')) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "idempotencyKey" TEXT');
    const eventSequenceAdded = !hasColumn('AgentRunEvent', 'sequence');
    if (eventSequenceAdded) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('AgentRunEvent', 'taskId')) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "taskId" TEXT');
    if (!hasColumn('AgentRunEvent', 'agentId')) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "agentId" TEXT');
    if (!hasColumn('AgentRunEvent', 'attempt')) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "attempt" INTEGER');
    if (!hasColumn('AgentRunEvent', 'actor')) db.exec('ALTER TABLE "AgentRunEvent" ADD COLUMN "actor" TEXT');
    const eventSequenceNeedsRepair = eventSequenceAdded || Boolean(db.prepare(`
      SELECT 1
      FROM "AgentRunEvent"
      GROUP BY "runId", "sequence"
      HAVING COUNT(*) > 1 OR "sequence" < 1
      LIMIT 1
    `).get());
    if (eventSequenceNeedsRepair) {
      if (hasIndex('AgentRunEvent_runId_sequence_key')) {
        db.exec('DROP INDEX "AgentRunEvent_runId_sequence_key"');
      }
      db.exec(`
        WITH ranked AS (
          SELECT "id", ROW_NUMBER() OVER (PARTITION BY "runId" ORDER BY "createdAt", "id") AS "nextSequence"
          FROM "AgentRunEvent"
        )
        UPDATE "AgentRunEvent"
        SET "sequence" = (SELECT "nextSequence" FROM ranked WHERE ranked."id" = "AgentRunEvent"."id");
      `);
    }
    db.exec(`
      UPDATE "AgentRun"
      SET "eventSequence" = COALESCE((
        SELECT MAX("sequence") FROM "AgentRunEvent" WHERE "AgentRunEvent"."runId" = "AgentRun"."id"
      ), 0);
    `);
    if (!hasColumn('SpaceMessage', 'sourceKey')) db.exec('ALTER TABLE "SpaceMessage" ADD COLUMN "sourceKey" TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS "SpaceFile_runId_idx" ON "SpaceFile"("runId");
      CREATE INDEX IF NOT EXISTS "SpaceFile_taskId_idx" ON "SpaceFile"("taskId");
      CREATE UNIQUE INDEX IF NOT EXISTS "SpaceFile_shareId_key" ON "SpaceFile"("shareId");
      CREATE INDEX IF NOT EXISTS "AgentRun_workerId_heartbeatAt_idx" ON "AgentRun"("workerId", "heartbeatAt");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRun_completionId_key" ON "AgentRun"("completionId");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunEvent_idempotencyKey_key" ON "AgentRunEvent"("idempotencyKey");
      CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunEvent_runId_sequence_key" ON "AgentRunEvent"("runId", "sequence");
      CREATE INDEX IF NOT EXISTS "AgentRunEvent_runId_taskId_sequence_idx" ON "AgentRunEvent"("runId", "taskId", "sequence");
      CREATE UNIQUE INDEX IF NOT EXISTS "SpaceMessage_sourceKey_key" ON "SpaceMessage"("sourceKey");
    `);
  })();

  console.log('Space and Agent Runtime database upgrade completed.');
} finally {
  db.close();
}
