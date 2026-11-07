CREATE TABLE "UserCustomApp" (
    "id" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(32) NOT NULL DEFAULT 'web',
    "name" VARCHAR(64) NOT NULL,
    "startUrl" VARCHAR(2048) NOT NULL,
    "iconId" VARCHAR(64),
    "iconSource" VARCHAR(16) NOT NULL DEFAULT 'favicon',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCustomApp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserCustomAppTombstone" (
    "userId" TEXT NOT NULL,
    "appId" VARCHAR(64) NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCustomAppTombstone_pkey" PRIMARY KEY ("userId","appId")
);

CREATE TABLE "UserCustomAppIconAsset" (
    "id" VARCHAR(64) NOT NULL,
    "userId" TEXT NOT NULL,
    "appId" VARCHAR(64),
    "storageKey" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL DEFAULT 'image/png',
    "byteSize" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "deletePending" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCustomAppIconAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserCustomAppSettings" (
    "userId" TEXT NOT NULL,
    "dockAppIds" JSONB NOT NULL DEFAULT '[]',
    "dockMigrationIds" JSONB NOT NULL DEFAULT '[]',
    "dockCatalogVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "initializedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCustomAppSettings_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "UserCustomAppOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" VARCHAR(200) NOT NULL,
    "operationHash" VARCHAR(64) NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCustomAppOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserCustomApp_iconId_key" ON "UserCustomApp"("iconId");
CREATE INDEX "UserCustomApp_userId_createdAt_id_idx" ON "UserCustomApp"("userId", "createdAt", "id");
CREATE INDEX "UserCustomApp_kind_userId_idx" ON "UserCustomApp"("kind", "userId");
CREATE INDEX "UserCustomAppTombstone_deletedAt_idx" ON "UserCustomAppTombstone"("deletedAt");
CREATE UNIQUE INDEX "UserCustomAppIconAsset_storageKey_key" ON "UserCustomAppIconAsset"("storageKey");
CREATE INDEX "UserCustomAppIconAsset_userId_status_createdAt_idx" ON "UserCustomAppIconAsset"("userId", "status", "createdAt");
CREATE INDEX "UserCustomAppIconAsset_appId_createdAt_idx" ON "UserCustomAppIconAsset"("appId", "createdAt");
CREATE INDEX "UserCustomAppIconAsset_deletePending_updatedAt_idx" ON "UserCustomAppIconAsset"("deletePending", "updatedAt");
CREATE UNIQUE INDEX "UserCustomAppOperation_userId_operationId_key" ON "UserCustomAppOperation"("userId", "operationId");
CREATE INDEX "UserCustomAppOperation_expiresAt_idx" ON "UserCustomAppOperation"("expiresAt");

ALTER TABLE "UserCustomApp" ADD CONSTRAINT "UserCustomApp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCustomApp" ADD CONSTRAINT "UserCustomApp_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "UserCustomAppIconAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserCustomAppTombstone" ADD CONSTRAINT "UserCustomAppTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCustomAppIconAsset" ADD CONSTRAINT "UserCustomAppIconAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCustomAppIconAsset" ADD CONSTRAINT "UserCustomAppIconAsset_appId_fkey" FOREIGN KEY ("appId") REFERENCES "UserCustomApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserCustomAppSettings" ADD CONSTRAINT "UserCustomAppSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCustomAppOperation" ADD CONSTRAINT "UserCustomAppOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
