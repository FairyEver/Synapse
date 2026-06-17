ALTER TABLE "DriveUploadSession"
ADD COLUMN "reservedBytes" BIGINT NOT NULL DEFAULT 0;

UPDATE "DriveUploadSession"
SET "reservedBytes" = "expectedSize"
WHERE "status" = 'pending';
