ALTER TABLE "Space" ADD COLUMN "cryptoFollowUpQQEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SpaceFollowUp" ADD COLUMN "qqReminderId" TEXT REFERENCES "AssistantReminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "SpaceFollowUp_qqReminderId_key" ON "SpaceFollowUp"("qqReminderId");
