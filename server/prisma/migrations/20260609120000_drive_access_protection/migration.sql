ALTER TABLE "DriveShare"
  ADD COLUMN "passwordEncrypted" TEXT;

CREATE INDEX "DriveShare_enabled_passwordEnabled_idx"
  ON "DriveShare"("enabled", "passwordEnabled");

ALTER TABLE "DrivePublication"
  ADD COLUMN "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "passwordEncrypted" TEXT,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "DrivePublication_status_passwordEnabled_idx"
  ON "DrivePublication"("status", "passwordEnabled");
