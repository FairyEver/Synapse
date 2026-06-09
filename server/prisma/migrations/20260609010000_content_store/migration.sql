CREATE TABLE "ContentStoreItem" (
  "id" TEXT NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "ownerUserId" TEXT NOT NULL,
  "visibility" VARCHAR(16) NOT NULL,
  "moderationStatus" VARCHAR(16) NOT NULL,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "copiedFromContentId" TEXT,
  "copiedFromVersionId" TEXT,
  "localSourceFingerprint" VARCHAR(128),
  "latestVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentStoreItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentStoreDraft" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "baseVersionId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "body" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentStoreDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentStoreVersion" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "body" TEXT,
  "packageKey" TEXT,
  "packageSha256" VARCHAR(64),
  "packageSize" BIGINT,
  "searchText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentStoreVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentStoreFile" (
  "id" TEXT NOT NULL,
  "draftId" TEXT,
  "versionId" TEXT,
  "path" VARCHAR(1024) NOT NULL,
  "size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "mimeType" VARCHAR(255),
  "storageKey" TEXT,
  "text" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentStoreFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentStoreInstallSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "type" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentStoreInstallSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentStoreInstallEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "clientInstanceId" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentStoreInstallEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentStoreItem_type_visibility_moderationStatus_featured_updatedAt_idx"
  ON "ContentStoreItem"("type", "visibility", "moderationStatus", "featured", "updatedAt");

CREATE INDEX "ContentStoreItem_ownerUserId_type_updatedAt_idx"
  ON "ContentStoreItem"("ownerUserId", "type", "updatedAt");

CREATE INDEX "ContentStoreItem_ownerUserId_localSourceFingerprint_idx"
  ON "ContentStoreItem"("ownerUserId", "localSourceFingerprint");

CREATE UNIQUE INDEX "ContentStoreDraft_itemId_key"
  ON "ContentStoreDraft"("itemId");

CREATE INDEX "ContentStoreDraft_ownerUserId_updatedAt_idx"
  ON "ContentStoreDraft"("ownerUserId", "updatedAt");

CREATE UNIQUE INDEX "ContentStoreVersion_packageKey_key"
  ON "ContentStoreVersion"("packageKey");

CREATE UNIQUE INDEX "ContentStoreVersion_itemId_versionNumber_key"
  ON "ContentStoreVersion"("itemId", "versionNumber");

CREATE INDEX "ContentStoreVersion_itemId_createdAt_idx"
  ON "ContentStoreVersion"("itemId", "createdAt");

CREATE INDEX "ContentStoreVersion_searchText_idx"
  ON "ContentStoreVersion"("searchText");

CREATE UNIQUE INDEX "ContentStoreFile_draftId_path_key"
  ON "ContentStoreFile"("draftId", "path");

CREATE UNIQUE INDEX "ContentStoreFile_versionId_path_key"
  ON "ContentStoreFile"("versionId", "path");

CREATE INDEX "ContentStoreFile_sha256_idx"
  ON "ContentStoreFile"("sha256");

CREATE INDEX "ContentStoreInstallSession_userId_status_expiresAt_idx"
  ON "ContentStoreInstallSession"("userId", "status", "expiresAt");

CREATE INDEX "ContentStoreInstallSession_itemId_versionId_idx"
  ON "ContentStoreInstallSession"("itemId", "versionId");

CREATE UNIQUE INDEX "ContentStoreInstallEvent_userId_itemId_versionId_clientInstanceId_key"
  ON "ContentStoreInstallEvent"("userId", "itemId", "versionId", "clientInstanceId");

CREATE INDEX "ContentStoreInstallEvent_itemId_versionId_idx"
  ON "ContentStoreInstallEvent"("itemId", "versionId");

ALTER TABLE "ContentStoreItem"
  ADD CONSTRAINT "ContentStoreItem_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreDraft"
  ADD CONSTRAINT "ContentStoreDraft_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ContentStoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreDraft"
  ADD CONSTRAINT "ContentStoreDraft_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreVersion"
  ADD CONSTRAINT "ContentStoreVersion_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ContentStoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreFile"
  ADD CONSTRAINT "ContentStoreFile_draftId_fkey"
  FOREIGN KEY ("draftId") REFERENCES "ContentStoreDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreFile"
  ADD CONSTRAINT "ContentStoreFile_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ContentStoreVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallSession"
  ADD CONSTRAINT "ContentStoreInstallSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallSession"
  ADD CONSTRAINT "ContentStoreInstallSession_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ContentStoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallSession"
  ADD CONSTRAINT "ContentStoreInstallSession_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ContentStoreVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallEvent"
  ADD CONSTRAINT "ContentStoreInstallEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallEvent"
  ADD CONSTRAINT "ContentStoreInstallEvent_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ContentStoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStoreInstallEvent"
  ADD CONSTRAINT "ContentStoreInstallEvent_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "ContentStoreVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
