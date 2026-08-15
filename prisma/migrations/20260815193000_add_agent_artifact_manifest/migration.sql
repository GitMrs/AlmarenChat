CREATE TABLE "AgentArtifactManifest" (
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

CREATE UNIQUE INDEX "AgentArtifactManifest_taskId_attempt_key" ON "AgentArtifactManifest"("taskId", "attempt");
CREATE INDEX "AgentArtifactManifest_runId_createdAt_idx" ON "AgentArtifactManifest"("runId", "createdAt");
