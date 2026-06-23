CREATE TABLE "DriveSite" (
  "id" TEXT NOT NULL,
  "siteId" VARCHAR(48) NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "accessMode" VARCHAR(32) NOT NULL,
  "passwordHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "currentDeploymentId" TEXT,
  "sourceFolderItemId" TEXT,
  "sourceFolderName" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveSite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveSiteDeployment" (
  "id" TEXT NOT NULL,
  "driveSiteId" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "entryPath" VARCHAR(1024) NOT NULL,
  "fileCount" INTEGER NOT NULL,
  "totalBytes" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "DriveSiteDeployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveSiteAsset" (
  "id" TEXT NOT NULL,
  "driveSiteId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "relativePath" VARCHAR(1024) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" VARCHAR(255),
  "size" BIGINT NOT NULL,
  "sha256" TEXT,
  CONSTRAINT "DriveSiteAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveSite_siteId_key" ON "DriveSite"("siteId");
CREATE INDEX "DriveSite_userId_createdAt_idx" ON "DriveSite"("userId", "createdAt");
CREATE INDEX "DriveSite_userId_status_updatedAt_idx" ON "DriveSite"("userId", "status", "updatedAt");
CREATE INDEX "DriveSite_sourceFolderItemId_idx" ON "DriveSite"("sourceFolderItemId");
CREATE INDEX "DriveSiteDeployment_driveSiteId_createdAt_idx" ON "DriveSiteDeployment"("driveSiteId", "createdAt");
CREATE INDEX "DriveSiteDeployment_status_idx" ON "DriveSiteDeployment"("status");
CREATE UNIQUE INDEX "DriveSiteAsset_storageKey_key" ON "DriveSiteAsset"("storageKey");
CREATE UNIQUE INDEX "DriveSiteAsset_deploymentId_relativePath_key" ON "DriveSiteAsset"("deploymentId", "relativePath");
CREATE INDEX "DriveSiteAsset_driveSiteId_deploymentId_idx" ON "DriveSiteAsset"("driveSiteId", "deploymentId");
CREATE INDEX "DriveSiteAsset_sourceItemId_idx" ON "DriveSiteAsset"("sourceItemId");

ALTER TABLE "DriveSite"
ADD CONSTRAINT "DriveSite_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveSiteDeployment"
ADD CONSTRAINT "DriveSiteDeployment_driveSiteId_fkey"
FOREIGN KEY ("driveSiteId") REFERENCES "DriveSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveSiteAsset"
ADD CONSTRAINT "DriveSiteAsset_driveSiteId_fkey"
FOREIGN KEY ("driveSiteId") REFERENCES "DriveSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveSiteAsset"
ADD CONSTRAINT "DriveSiteAsset_deploymentId_fkey"
FOREIGN KEY ("deploymentId") REFERENCES "DriveSiteDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
