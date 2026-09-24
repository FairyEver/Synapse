CREATE TABLE "DriveFileReadLease" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriveFileReadLease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveFilePatchRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "previousVersionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "applied" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriveFilePatchRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriveFileReadLease_versionId_expiresAt_idx" ON "DriveFileReadLease"("versionId", "expiresAt");
CREATE INDEX "DriveFileReadLease_expiresAt_idx" ON "DriveFileReadLease"("expiresAt");
CREATE UNIQUE INDEX "DriveFilePatchRequest_userId_itemId_idempotencyKey_key" ON "DriveFilePatchRequest"("userId", "itemId", "idempotencyKey");
CREATE INDEX "DriveFilePatchRequest_expiresAt_idx" ON "DriveFilePatchRequest"("expiresAt");
ALTER TABLE "DriveFileReadLease" ADD CONSTRAINT "DriveFileReadLease_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DriveFileVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
