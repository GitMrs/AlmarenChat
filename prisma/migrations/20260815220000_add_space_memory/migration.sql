CREATE TABLE "SpaceMemory" (
    "spaceId" TEXT NOT NULL PRIMARY KEY,
    "recentActivity" JSONB NOT NULL,
    "rollingSummary" TEXT,
    "historySummary" TEXT,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpaceMemory_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
