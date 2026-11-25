-- AlterTable
ALTER TABLE "UserApiKey"
ADD COLUMN "stateSyncAccessMode" VARCHAR(16) DEFAULT 'selected',
ADD COLUMN "stateSyncSpaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "StateSyncSpace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "defaultDocTtlSeconds" INTEGER DEFAULT 86400,
    "maxDocs" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateSyncSpace_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StateSyncSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StateSyncToken" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "tokenPrefix" VARCHAR(24) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StateSyncToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StateSyncToken_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "StateSyncToken_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "StateSyncSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StateSyncDoc" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "rev" BIGINT NOT NULL DEFAULT 0,
    "ttlSeconds" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StateSyncDoc_pkey" PRIMARY KEY ("spaceId", "id"),
    CONSTRAINT "StateSyncDoc_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "StateSyncSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StateSyncSpace_ownerId_createdAt_idx" ON "StateSyncSpace"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "StateSyncToken_spaceId_revokedAt_createdAt_idx" ON "StateSyncToken"("spaceId", "revokedAt", "createdAt");

-- CreateIndex
CREATE INDEX "StateSyncDoc_spaceId_updatedAt_idx" ON "StateSyncDoc"("spaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "StateSyncDoc_expiresAt_idx" ON "StateSyncDoc"("expiresAt");
