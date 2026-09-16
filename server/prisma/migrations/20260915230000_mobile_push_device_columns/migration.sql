-- AlterTable
-- Notification target for a mobile client registered against this account.
-- Every column is nullable so the migration stays additive and non-locking on a
-- live table; a null "pushToken" already means "not registered".
ALTER TABLE "UserDevice" ADD COLUMN     "pushToken" VARCHAR(200),
ADD COLUMN     "pushPlatform" VARCHAR(20),
ADD COLUMN     "lastPushAt" TIMESTAMP(3);
