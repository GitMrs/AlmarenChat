CREATE TABLE "PlatformNotification" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "baseUrl" TEXT NOT NULL,
  "tokenCiphertext" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PlatformNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "AssistantReminder" ADD COLUMN "notificationChannel" TEXT NOT NULL DEFAULT 'PERSONAL_QQ';
