ALTER TABLE "Space" ADD COLUMN "executionEngine" TEXT NOT NULL DEFAULT 'native';

UPDATE "Space"
SET "executionEngine" = 'pi'
WHERE "runtimeType" = 'PI_CODING';
