ALTER TABLE "UserApiKey"
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lastUsedAt" TIMESTAMP(3);

CREATE TABLE "OpenApiDownloadGrant" (
  "id" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceType" VARCHAR(32) NOT NULL,
  "artifactType" VARCHAR(16) NOT NULL,
  "planVersion" INTEGER NOT NULL DEFAULT 1,
  "snapshotId" VARCHAR(64) NOT NULL,
  "fileName" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(255) NOT NULL,
  "size" BIGINT,
  "entryPath" VARCHAR(1024),
  "target" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenApiDownloadGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpenApiDownloadGrantEntry" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "entryType" VARCHAR(16) NOT NULL,
  "relativePath" VARCHAR(1024),
  "storageKey" TEXT,
  "driveFileVersionId" TEXT,
  "size" BIGINT,
  "mimeType" VARCHAR(255),
  "etag" TEXT,
  "sha256" VARCHAR(64),
  CONSTRAINT "OpenApiDownloadGrantEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpenApiUsageLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "grantId" TEXT,
  "requestId" VARCHAR(64) NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "scope" VARCHAR(120) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "httpStatus" INTEGER,
  "errorCode" VARCHAR(64),
  "sourceType" VARCHAR(32),
  "artifactType" VARCHAR(16),
  "durationMs" INTEGER,
  "responseBytes" BIGINT,
  "ipAddress" VARCHAR(64) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OpenApiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpenApiDownloadGrant_tokenHash_key" ON "OpenApiDownloadGrant"("tokenHash");
CREATE INDEX "OpenApiDownloadGrant_apiKeyId_expiresAt_idx" ON "OpenApiDownloadGrant"("apiKeyId", "expiresAt");
CREATE INDEX "OpenApiDownloadGrant_expiresAt_idx" ON "OpenApiDownloadGrant"("expiresAt");
CREATE INDEX "OpenApiDownloadGrant_leaseUntil_idx" ON "OpenApiDownloadGrant"("leaseUntil");
CREATE UNIQUE INDEX "OpenApiDownloadGrantEntry_grantId_ordinal_key" ON "OpenApiDownloadGrantEntry"("grantId", "ordinal");
CREATE INDEX "OpenApiDownloadGrantEntry_driveFileVersionId_grantId_idx" ON "OpenApiDownloadGrantEntry"("driveFileVersionId", "grantId");
CREATE UNIQUE INDEX "OpenApiUsageLog_requestId_key" ON "OpenApiUsageLog"("requestId");
CREATE INDEX "OpenApiUsageLog_apiKeyId_startedAt_idx" ON "OpenApiUsageLog"("apiKeyId", "startedAt");
CREATE INDEX "OpenApiUsageLog_userId_startedAt_idx" ON "OpenApiUsageLog"("userId", "startedAt");
CREATE INDEX "OpenApiUsageLog_startedAt_idx" ON "OpenApiUsageLog"("startedAt");

ALTER TABLE "OpenApiDownloadGrant" ADD CONSTRAINT "OpenApiDownloadGrant_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "UserApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenApiDownloadGrant" ADD CONSTRAINT "OpenApiDownloadGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenApiDownloadGrantEntry" ADD CONSTRAINT "OpenApiDownloadGrantEntry_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "OpenApiDownloadGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenApiDownloadGrantEntry" ADD CONSTRAINT "OpenApiDownloadGrantEntry_driveFileVersionId_fkey"
  FOREIGN KEY ("driveFileVersionId") REFERENCES "DriveFileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenApiUsageLog" ADD CONSTRAINT "OpenApiUsageLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpenApiUsageLog" ADD CONSTRAINT "OpenApiUsageLog_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "UserApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
