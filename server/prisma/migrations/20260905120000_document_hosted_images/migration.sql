CREATE TABLE "DocumentImageUploadSession" (
    "id" TEXT NOT NULL,
    "imageId" VARCHAR(36) NOT NULL,
    "actorUserId" TEXT,
    "sourceItemId" TEXT,
    "storageKey" TEXT NOT NULL,
    "expectedName" VARCHAR(255) NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "expectedMime" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    CONSTRAINT "DocumentImageUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentHostedImage" (
    "id" TEXT NOT NULL,
    "imageId" VARCHAR(36) NOT NULL,
    "uploadedByUserId" TEXT,
    "sourceItemId" TEXT,
    "originalName" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "etag" TEXT,
    "status" VARCHAR(32) NOT NULL DEFAULT 'temporary',
    "expiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "quarantinedAt" TIMESTAMP(3),
    "quarantinedBy" TEXT,
    "deletePending" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DocumentHostedImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentImageUploadSession_imageId_key" ON "DocumentImageUploadSession"("imageId");
CREATE UNIQUE INDEX "DocumentImageUploadSession_storageKey_key" ON "DocumentImageUploadSession"("storageKey");
CREATE INDEX "DocumentImageUploadSession_actorUserId_status_createdAt_idx" ON "DocumentImageUploadSession"("actorUserId", "status", "createdAt");
CREATE INDEX "DocumentImageUploadSession_sourceItemId_status_createdAt_idx" ON "DocumentImageUploadSession"("sourceItemId", "status", "createdAt");
CREATE INDEX "DocumentImageUploadSession_expiresAt_status_idx" ON "DocumentImageUploadSession"("expiresAt", "status");
CREATE UNIQUE INDEX "DocumentHostedImage_imageId_key" ON "DocumentHostedImage"("imageId");
CREATE UNIQUE INDEX "DocumentHostedImage_storageKey_key" ON "DocumentHostedImage"("storageKey");
CREATE INDEX "DocumentHostedImage_status_expiresAt_idx" ON "DocumentHostedImage"("status", "expiresAt");
CREATE INDEX "DocumentHostedImage_sourceItemId_status_createdAt_idx" ON "DocumentHostedImage"("sourceItemId", "status", "createdAt");
CREATE INDEX "DocumentHostedImage_uploadedByUserId_status_createdAt_idx" ON "DocumentHostedImage"("uploadedByUserId", "status", "createdAt");
CREATE INDEX "DocumentHostedImage_deletePending_updatedAt_idx" ON "DocumentHostedImage"("deletePending", "updatedAt");
ALTER TABLE "DocumentImageUploadSession" ADD CONSTRAINT "DocumentImageUploadSession_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentImageUploadSession" ADD CONSTRAINT "DocumentImageUploadSession_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentHostedImage" ADD CONSTRAINT "DocumentHostedImage_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DocumentHostedImage" ADD CONSTRAINT "DocumentHostedImage_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
