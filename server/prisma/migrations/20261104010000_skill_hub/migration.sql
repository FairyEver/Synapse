-- CreateEnum
CREATE TYPE "SkillHubUploadPurpose" AS ENUM ('package', 'icon');

-- CreateEnum
CREATE TYPE "SkillHubUploadState" AS ENUM ('staging', 'ready', 'bound', 'cleanup');

-- CreateEnum
CREATE TYPE "SkillHubObjectKind" AS ENUM ('archive', 'main', 'icon');

-- CreateEnum
CREATE TYPE "SkillHubObjectState" AS ENUM ('staging', 'ready', 'deletePending');

-- CreateTable
CREATE TABLE "SkillHubSkill" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "maintainerUserId" TEXT,
    "maintainerName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "displayDescription" TEXT NOT NULL,
    "iconObjectId" TEXT,
    "currentVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "SkillHubSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillHubVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "packageName" TEXT NOT NULL,
    "packageDescription" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "archiveObjectId" TEXT NOT NULL,
    "mainObjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillHubVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillHubUpload" (
    "id" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "purpose" "SkillHubUploadPurpose" NOT NULL,
    "state" "SkillHubUploadState" NOT NULL DEFAULT 'staging',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "inputSha256" TEXT NOT NULL,
    "packageName" TEXT,
    "packageDescription" TEXT,
    "manifest" JSONB,
    "contentFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillHubUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillHubObject" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" "SkillHubObjectKind" NOT NULL,
    "state" "SkillHubObjectState" NOT NULL DEFAULT 'staging',
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "nextCleanupAt" TIMESTAMP(3),
    "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillHubObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillHubWriteReceipt" (
    "id" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "versionId" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillHubWriteReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillHubSkill_teamId_deletedAt_publishedAt_id_idx" ON "SkillHubSkill"("teamId", "deletedAt", "publishedAt", "id");

-- CreateIndex
CREATE INDEX "SkillHubSkill_createdById_idx" ON "SkillHubSkill"("createdById");

-- CreateIndex
CREATE INDEX "SkillHubSkill_maintainerUserId_idx" ON "SkillHubSkill"("maintainerUserId");

-- CreateIndex
CREATE INDEX "SkillHubSkill_deletedById_idx" ON "SkillHubSkill"("deletedById");

-- CreateIndex
CREATE INDEX "SkillHubSkill_iconObjectId_idx" ON "SkillHubSkill"("iconObjectId");

-- CreateIndex
CREATE INDEX "SkillHubVersion_archiveObjectId_idx" ON "SkillHubVersion"("archiveObjectId");

-- CreateIndex
CREATE INDEX "SkillHubVersion_mainObjectId_idx" ON "SkillHubVersion"("mainObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubVersion_skillId_id_key" ON "SkillHubVersion"("skillId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubVersion_skillId_number_key" ON "SkillHubVersion"("skillId", "number");

-- CreateIndex
CREATE INDEX "SkillHubUpload_state_expiresAt_id_idx" ON "SkillHubUpload"("state", "expiresAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubUpload_actorKey_teamId_purpose_requestId_key" ON "SkillHubUpload"("actorKey", "teamId", "purpose", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubObject_storageKey_key" ON "SkillHubObject"("storageKey");

-- CreateIndex
CREATE INDEX "SkillHubObject_state_nextCleanupAt_id_idx" ON "SkillHubObject"("state", "nextCleanupAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubObject_uploadId_kind_key" ON "SkillHubObject"("uploadId", "kind");

-- CreateIndex
CREATE INDEX "SkillHubWriteReceipt_skillId_versionId_idx" ON "SkillHubWriteReceipt"("skillId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillHubWriteReceipt_actorKey_action_requestId_key" ON "SkillHubWriteReceipt"("actorKey", "action", "requestId");

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_maintainerUserId_fkey" FOREIGN KEY ("maintainerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_iconObjectId_fkey" FOREIGN KEY ("iconObjectId") REFERENCES "SkillHubObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_id_currentVersionId_fkey" FOREIGN KEY ("id", "currentVersionId") REFERENCES "SkillHubVersion"("skillId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SkillHubSkill" ADD CONSTRAINT "SkillHubSkill_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubVersion" ADD CONSTRAINT "SkillHubVersion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillHubSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubVersion" ADD CONSTRAINT "SkillHubVersion_archiveObjectId_fkey" FOREIGN KEY ("archiveObjectId") REFERENCES "SkillHubObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubVersion" ADD CONSTRAINT "SkillHubVersion_mainObjectId_fkey" FOREIGN KEY ("mainObjectId") REFERENCES "SkillHubObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubObject" ADD CONSTRAINT "SkillHubObject_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "SkillHubUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubWriteReceipt" ADD CONSTRAINT "SkillHubWriteReceipt_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillHubSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillHubWriteReceipt" ADD CONSTRAINT "SkillHubWriteReceipt_skillId_versionId_fkey" FOREIGN KEY ("skillId", "versionId") REFERENCES "SkillHubVersion"("skillId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
