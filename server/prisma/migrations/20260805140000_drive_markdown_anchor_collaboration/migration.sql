-- Anchor V1 offsets were measured in browser UTF-16 units and cannot be
-- losslessly reinterpreted as Anchor V2 Unicode code-point offsets. The
-- rollout intentionally removes legacy annotation data while preserving
-- DriveItem, DriveShare and DriveFileVersion records.
DELETE FROM "DriveAnnotationThread";

CREATE TABLE "DriveAnnotationAnchor" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 2,
    "baseVersionId" TEXT,
    "selectors" JSONB NOT NULL,
    "positionStatus" VARCHAR(32) NOT NULL DEFAULT 'attached',
    "quoteStatus" VARCHAR(16) NOT NULL DEFAULT 'exact',
    "lastResolvedVersionId" TEXT,
    "resolvedSourceStart" INTEGER,
    "resolvedSourceEnd" INTEGER,
    "resolvedRenderedStart" INTEGER,
    "resolvedRenderedEnd" INTEGER,
    "confidence" DOUBLE PRECISION,
    "idempotencyKey" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "DriveAnnotationAnchor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveCollaborationDocument" (
    "itemId" TEXT NOT NULL,
    "epoch" VARCHAR(64) NOT NULL,
    "checkpointVersionId" TEXT NOT NULL,
    "snapshotStorageKey" TEXT,
    "snapshotSha256" VARCHAR(64),
    "durableSequence" BIGINT NOT NULL DEFAULT 0,
    "checkpointSequence" BIGINT NOT NULL DEFAULT 0,
    "reservedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriveCollaborationDocument_pkey" PRIMARY KEY ("itemId")
);

CREATE TABLE "DriveCollaborationSegment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "epoch" VARCHAR(64) NOT NULL,
    "sequenceStart" BIGINT NOT NULL,
    "sequenceEnd" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "deletePending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriveCollaborationSegment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveMarkdownProjection" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "sourceSha256" VARCHAR(64) NOT NULL,
    "parserVersion" VARCHAR(32) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ready',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriveMarkdownProjection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveFileVersionContributor" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sequenceStart" BIGINT NOT NULL,
    "sequenceEnd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriveFileVersionContributor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveAnnotationAnchor_threadId_key" ON "DriveAnnotationAnchor"("threadId");
CREATE UNIQUE INDEX "DriveAnnotationAnchor_idempotencyKey_key" ON "DriveAnnotationAnchor"("idempotencyKey");
CREATE INDEX "DriveAnnotationAnchor_itemId_positionStatus_updatedAt_idx" ON "DriveAnnotationAnchor"("itemId", "positionStatus", "updatedAt");
CREATE INDEX "DriveAnnotationAnchor_baseVersionId_idx" ON "DriveAnnotationAnchor"("baseVersionId");
CREATE INDEX "DriveAnnotationAnchor_lastResolvedVersionId_idx" ON "DriveAnnotationAnchor"("lastResolvedVersionId");
CREATE INDEX "DriveCollaborationDocument_epoch_idx" ON "DriveCollaborationDocument"("epoch");
CREATE INDEX "DriveCollaborationDocument_checkpointVersionId_idx" ON "DriveCollaborationDocument"("checkpointVersionId");
CREATE UNIQUE INDEX "DriveCollaborationSegment_storageKey_key" ON "DriveCollaborationSegment"("storageKey");
CREATE UNIQUE INDEX "DriveCollaborationSegment_itemId_epoch_sequenceStart_key" ON "DriveCollaborationSegment"("itemId", "epoch", "sequenceStart");
CREATE INDEX "DriveCollaborationSegment_itemId_epoch_sequenceEnd_idx" ON "DriveCollaborationSegment"("itemId", "epoch", "sequenceEnd");
CREATE INDEX "DriveCollaborationSegment_deletePending_createdAt_idx" ON "DriveCollaborationSegment"("deletePending", "createdAt");
CREATE UNIQUE INDEX "DriveMarkdownProjection_versionId_key" ON "DriveMarkdownProjection"("versionId");
CREATE UNIQUE INDEX "DriveMarkdownProjection_storageKey_key" ON "DriveMarkdownProjection"("storageKey");
CREATE INDEX "DriveMarkdownProjection_itemId_createdAt_idx" ON "DriveMarkdownProjection"("itemId", "createdAt");
CREATE INDEX "DriveMarkdownProjection_status_updatedAt_idx" ON "DriveMarkdownProjection"("status", "updatedAt");
CREATE UNIQUE INDEX "DriveFileVersionContributor_versionId_userId_key" ON "DriveFileVersionContributor"("versionId", "userId");
CREATE INDEX "DriveFileVersionContributor_userId_createdAt_idx" ON "DriveFileVersionContributor"("userId", "createdAt");

ALTER TABLE "DriveAnnotationAnchor" ADD CONSTRAINT "DriveAnnotationAnchor_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DriveAnnotationThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveAnnotationAnchor" ADD CONSTRAINT "DriveAnnotationAnchor_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveCollaborationDocument" ADD CONSTRAINT "DriveCollaborationDocument_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveCollaborationSegment" ADD CONSTRAINT "DriveCollaborationSegment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveMarkdownProjection" ADD CONSTRAINT "DriveMarkdownProjection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveMarkdownProjection" ADD CONSTRAINT "DriveMarkdownProjection_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DriveFileVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveFileVersionContributor" ADD CONSTRAINT "DriveFileVersionContributor_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DriveFileVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveFileVersionContributor" ADD CONSTRAINT "DriveFileVersionContributor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
