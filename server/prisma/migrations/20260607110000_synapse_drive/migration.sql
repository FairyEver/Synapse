CREATE TABLE "DriveItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "type" VARCHAR(16) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "size" BIGINT NOT NULL DEFAULT 0,
  "mimeType" VARCHAR(255),
  "storageKey" TEXT,
  "storageStatus" VARCHAR(32) NOT NULL,
  "uploadStatus" VARCHAR(32) NOT NULL,
  "storageDeletePending" BOOLEAN NOT NULL DEFAULT false,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriveItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveShare" (
  "id" TEXT NOT NULL,
  "shareId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "passwordEnabled" BOOLEAN NOT NULL DEFAULT false,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "DriveShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveUsage" (
  "userId" TEXT NOT NULL,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "reservedBytes" BIGINT NOT NULL DEFAULT 0,
  "quotaBytes" BIGINT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriveUsage_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "DriveUploadSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "expectedName" VARCHAR(255) NOT NULL,
  "expectedSize" BIGINT NOT NULL,
  "expectedMime" VARCHAR(255),
  "status" VARCHAR(32) NOT NULL,
  "credentialKind" VARCHAR(32) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  CONSTRAINT "DriveUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveItem_storageKey_key" ON "DriveItem"("storageKey");
CREATE INDEX "DriveItem_userId_parentId_deletedAt_createdAt_idx" ON "DriveItem"("userId", "parentId", "deletedAt", "createdAt");
CREATE INDEX "DriveItem_userId_deletedAt_updatedAt_idx" ON "DriveItem"("userId", "deletedAt", "updatedAt");
CREATE INDEX "DriveItem_storageStatus_idx" ON "DriveItem"("storageStatus");
CREATE UNIQUE INDEX "DriveShare_shareId_key" ON "DriveShare"("shareId");
CREATE INDEX "DriveShare_itemId_enabled_idx" ON "DriveShare"("itemId", "enabled");
CREATE INDEX "DriveShare_userId_createdAt_idx" ON "DriveShare"("userId", "createdAt");
CREATE INDEX "DriveUploadSession_userId_status_createdAt_idx" ON "DriveUploadSession"("userId", "status", "createdAt");
CREATE INDEX "DriveUploadSession_expiresAt_status_idx" ON "DriveUploadSession"("expiresAt", "status");
CREATE INDEX "DriveUploadSession_itemId_idx" ON "DriveUploadSession"("itemId");

ALTER TABLE "DriveItem" ADD CONSTRAINT "DriveItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveItem" ADD CONSTRAINT "DriveItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveShare" ADD CONSTRAINT "DriveShare_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveUsage" ADD CONSTRAINT "DriveUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUploadSession" ADD CONSTRAINT "DriveUploadSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveUploadSession" ADD CONSTRAINT "DriveUploadSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
