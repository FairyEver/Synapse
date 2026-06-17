CREATE TABLE "DriveFileVersion" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "size" BIGINT NOT NULL,
  "mimeType" VARCHAR(255),
  "etag" TEXT,
  "source" VARCHAR(32) NOT NULL,
  "createdBy" TEXT,
  "restoredFromVersionId" TEXT,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "deletePending" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveFileVersion_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DriveFileVersion" (
  "id",
  "itemId",
  "userId",
  "versionNumber",
  "storageKey",
  "size",
  "mimeType",
  "source",
  "createdAt"
)
SELECT
  'dfv_' || substr(md5("id" || ':' || "storageKey" || ':' || "updatedAt"::text), 1, 24),
  "id",
  "userId",
  1,
  "storageKey",
  "size",
  "mimeType",
  'upload',
  "updatedAt"
FROM "DriveItem"
WHERE "type" = 'file'
  AND "storageStatus" = 'active'
  AND "deletedAt" IS NULL
  AND "storageKey" IS NOT NULL;

CREATE UNIQUE INDEX "DriveFileVersion_storageKey_key" ON "DriveFileVersion"("storageKey");
CREATE UNIQUE INDEX "DriveFileVersion_itemId_versionNumber_key" ON "DriveFileVersion"("itemId", "versionNumber");
CREATE INDEX "DriveFileVersion_itemId_deletedAt_versionNumber_idx" ON "DriveFileVersion"("itemId", "deletedAt", "versionNumber");
CREATE INDEX "DriveFileVersion_userId_createdAt_idx" ON "DriveFileVersion"("userId", "createdAt");
CREATE INDEX "DriveFileVersion_deletePending_idx" ON "DriveFileVersion"("deletePending");

ALTER TABLE "DriveFileVersion"
ADD CONSTRAINT "DriveFileVersion_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriveFileVersion"
ADD CONSTRAINT "DriveFileVersion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
