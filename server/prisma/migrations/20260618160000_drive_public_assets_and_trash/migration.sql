ALTER TABLE "DriveItem" ADD COLUMN "lifecycleStatus" VARCHAR(32) NOT NULL DEFAULT 'active';
ALTER TABLE "DriveItem" ADD COLUMN "trashedAt" TIMESTAMP(3);
ALTER TABLE "DriveItem" ADD COLUMN "trashedBy" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "DriveItem" ADD COLUMN "hiddenBy" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "restoreParentId" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "restorePath" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "deleteRootId" TEXT;
ALTER TABLE "DriveItem" ADD COLUMN "objectMissing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DriveUploadSession" ADD COLUMN "purpose" VARCHAR(32) NOT NULL DEFAULT 'drive_upload';
ALTER TABLE "DriveUploadSession" ADD COLUMN "publicAssetId" TEXT;
ALTER TABLE "DriveUploadSession" ADD COLUMN "replacePreviousStorageKey" TEXT;

UPDATE "DriveItem"
SET "lifecycleStatus" = CASE WHEN "deletedAt" IS NULL THEN 'active' ELSE 'legacy_missing' END,
    "objectMissing" = CASE WHEN "deletedAt" IS NULL THEN false ELSE true END;

CREATE TABLE "PublicAsset" (
  "id" TEXT NOT NULL,
  "assetId" VARCHAR(38) NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "size" BIGINT NOT NULL,
  "mimeType" VARCHAR(255) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "etag" TEXT,
  "lifecycleStatus" VARCHAR(32) NOT NULL DEFAULT 'active',
  "trashedAt" TIMESTAMP(3),
  "trashedBy" TEXT,
  "hiddenAt" TIMESTAMP(3),
  "hiddenBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "accessCount" BIGINT NOT NULL DEFAULT 0,
  "responseBytes" BIGINT NOT NULL DEFAULT 0,
  "lastAccessedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicAssetAccessLog" (
  "id" TEXT NOT NULL,
  "assetId" VARCHAR(38) NOT NULL,
  "publicAssetId" TEXT,
  "userId" TEXT,
  "ip" TEXT,
  "referer" TEXT,
  "userAgent" TEXT,
  "method" VARCHAR(16) NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "accessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicAssetAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicAssetRevision" (
  "id" TEXT NOT NULL,
  "assetId" VARCHAR(38) NOT NULL,
  "publicAssetId" TEXT,
  "itemId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "originalName" VARCHAR(255) NOT NULL,
  "size" BIGINT NOT NULL,
  "mimeType" VARCHAR(255),
  "etag" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedBy" TEXT,
  CONSTRAINT "PublicAssetRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriveItem_userId_parentId_lifecycleStatus_createdAt_idx" ON "DriveItem"("userId", "parentId", "lifecycleStatus", "createdAt");
CREATE INDEX "DriveItem_userId_lifecycleStatus_updatedAt_idx" ON "DriveItem"("userId", "lifecycleStatus", "updatedAt");
CREATE INDEX "DriveItem_deleteRootId_lifecycleStatus_idx" ON "DriveItem"("deleteRootId", "lifecycleStatus");
CREATE INDEX "DriveItem_objectMissing_idx" ON "DriveItem"("objectMissing");
CREATE INDEX "DriveUploadSession_purpose_status_createdAt_idx" ON "DriveUploadSession"("purpose", "status", "createdAt");
CREATE INDEX "DriveUploadSession_publicAssetId_status_createdAt_idx" ON "DriveUploadSession"("publicAssetId", "status", "createdAt");
CREATE UNIQUE INDEX "PublicAsset_assetId_key" ON "PublicAsset"("assetId");
CREATE UNIQUE INDEX "PublicAsset_itemId_key" ON "PublicAsset"("itemId");
CREATE UNIQUE INDEX "PublicAsset_storageKey_key" ON "PublicAsset"("storageKey");
CREATE INDEX "PublicAsset_userId_lifecycleStatus_createdAt_idx" ON "PublicAsset"("userId", "lifecycleStatus", "createdAt");
CREATE INDEX "PublicAsset_userId_lifecycleStatus_name_idx" ON "PublicAsset"("userId", "lifecycleStatus", "name");
CREATE INDEX "PublicAsset_userId_lastAccessedAt_idx" ON "PublicAsset"("userId", "lastAccessedAt");
CREATE INDEX "PublicAsset_lifecycleStatus_lastAccessedAt_idx" ON "PublicAsset"("lifecycleStatus", "lastAccessedAt");
CREATE INDEX "PublicAsset_lastAccessedAt_idx" ON "PublicAsset"("lastAccessedAt");
CREATE INDEX "PublicAssetAccessLog_assetId_accessedAt_idx" ON "PublicAssetAccessLog"("assetId", "accessedAt");
CREATE INDEX "PublicAssetAccessLog_publicAssetId_accessedAt_idx" ON "PublicAssetAccessLog"("publicAssetId", "accessedAt");
CREATE INDEX "PublicAssetAccessLog_userId_accessedAt_idx" ON "PublicAssetAccessLog"("userId", "accessedAt");
CREATE INDEX "PublicAssetAccessLog_statusCode_accessedAt_idx" ON "PublicAssetAccessLog"("statusCode", "accessedAt");
CREATE INDEX "PublicAssetAccessLog_method_accessedAt_idx" ON "PublicAssetAccessLog"("method", "accessedAt");
CREATE UNIQUE INDEX "PublicAssetRevision_storageKey_key" ON "PublicAssetRevision"("storageKey");
CREATE INDEX "PublicAssetRevision_publicAssetId_replacedAt_idx" ON "PublicAssetRevision"("publicAssetId", "replacedAt");
CREATE INDEX "PublicAssetRevision_assetId_replacedAt_idx" ON "PublicAssetRevision"("assetId", "replacedAt");

ALTER TABLE "DriveUploadSession"
ADD CONSTRAINT "DriveUploadSession_publicAssetId_fkey"
FOREIGN KEY ("publicAssetId") REFERENCES "PublicAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicAsset"
ADD CONSTRAINT "PublicAsset_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PublicAsset"
ADD CONSTRAINT "PublicAsset_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicAssetAccessLog"
ADD CONSTRAINT "PublicAssetAccessLog_publicAssetId_fkey"
FOREIGN KEY ("publicAssetId") REFERENCES "PublicAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicAssetRevision"
ADD CONSTRAINT "PublicAssetRevision_publicAssetId_fkey"
FOREIGN KEY ("publicAssetId") REFERENCES "PublicAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicAssetRevision"
ADD CONSTRAINT "PublicAssetRevision_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
