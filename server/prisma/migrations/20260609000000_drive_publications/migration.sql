CREATE TABLE "DrivePublication" (
  "id" TEXT NOT NULL,
  "publishId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "type" VARCHAR(16) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "currentDeploymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "DrivePublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DrivePublicationDeployment" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "DrivePublicationDeployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DrivePublicationAsset" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "relativePath" VARCHAR(1024) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentType" VARCHAR(255),
  "size" BIGINT NOT NULL,
  "sha256" VARCHAR(64),
  CONSTRAINT "DrivePublicationAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrivePublication_publishId_key" ON "DrivePublication"("publishId");
CREATE UNIQUE INDEX "DrivePublication_active_source_unique" ON "DrivePublication"("userId", "sourceItemId", "type") WHERE "status" = 'active' AND "sourceItemId" IS NOT NULL;
CREATE INDEX "DrivePublication_userId_createdAt_idx" ON "DrivePublication"("userId", "createdAt");
CREATE INDEX "DrivePublication_sourceItemId_status_idx" ON "DrivePublication"("sourceItemId", "status");
CREATE INDEX "DrivePublication_status_idx" ON "DrivePublication"("status");
CREATE UNIQUE INDEX "DrivePublicationDeployment_id_publicationId_key" ON "DrivePublicationDeployment"("id", "publicationId");
CREATE INDEX "DrivePublicationDeployment_publicationId_createdAt_idx" ON "DrivePublicationDeployment"("publicationId", "createdAt");
CREATE INDEX "DrivePublicationDeployment_status_idx" ON "DrivePublicationDeployment"("status");
CREATE UNIQUE INDEX "DrivePublicationAsset_storageKey_key" ON "DrivePublicationAsset"("storageKey");
CREATE UNIQUE INDEX "DrivePublicationAsset_deploymentId_relativePath_key" ON "DrivePublicationAsset"("deploymentId", "relativePath");
CREATE INDEX "DrivePublicationAsset_sourceItemId_idx" ON "DrivePublicationAsset"("sourceItemId");
CREATE INDEX "DrivePublicationAsset_publicationId_deploymentId_idx" ON "DrivePublicationAsset"("publicationId", "deploymentId");

ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DrivePublication" ADD CONSTRAINT "DrivePublication_currentDeploymentId_id_fkey" FOREIGN KEY ("currentDeploymentId", "id") REFERENCES "DrivePublicationDeployment"("id", "publicationId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationDeployment" ADD CONSTRAINT "DrivePublicationDeployment_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "DrivePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "DrivePublication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_deploymentId_publicationId_fkey" FOREIGN KEY ("deploymentId", "publicationId") REFERENCES "DrivePublicationDeployment"("id", "publicationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrivePublicationAsset" ADD CONSTRAINT "DrivePublicationAsset_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DriveItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
