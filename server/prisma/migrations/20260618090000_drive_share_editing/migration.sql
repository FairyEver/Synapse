ALTER TABLE "DriveShare"
  ADD COLUMN "accessMode" VARCHAR(32) NOT NULL DEFAULT 'link_read';

CREATE TABLE "DriveShareEditor" (
  "id" TEXT NOT NULL,
  "driveShareId" TEXT NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DriveShareEditor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveShareEditor_driveShareId_email_key"
  ON "DriveShareEditor"("driveShareId", "email");

CREATE INDEX "DriveShareEditor_email_idx"
  ON "DriveShareEditor"("email");

ALTER TABLE "DriveShareEditor"
  ADD CONSTRAINT "DriveShareEditor_driveShareId_fkey"
  FOREIGN KEY ("driveShareId") REFERENCES "DriveShare"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
