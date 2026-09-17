-- CreateTable
CREATE TABLE IF NOT EXISTS "StudioWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudioWorkspace_userId_createdAt_idx" ON "StudioWorkspace"("userId", "createdAt");

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudioMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT,
    "tools" JSON,
    "tokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudioMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "StudioWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudioMessage_workspaceId_createdAt_idx" ON "StudioMessage"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "StudioMessage_userId_createdAt_idx" ON "StudioMessage"("userId", "createdAt");
