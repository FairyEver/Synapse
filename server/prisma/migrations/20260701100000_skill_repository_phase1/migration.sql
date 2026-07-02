ALTER TABLE "User" ADD COLUMN "handle" VARCHAR(64);
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

CREATE TABLE "UserHandleRedirect" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldHandle" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserHandleRedirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserHandleRedirect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserHandleRedirect_oldHandle_key" ON "UserHandleRedirect"("oldHandle");
CREATE INDEX "UserHandleRedirect_userId_createdAt_idx" ON "UserHandleRedirect"("userId", "createdAt");

CREATE TABLE "SkillRepository" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" VARCHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "visibility" VARCHAR(16) NOT NULL DEFAULT 'private',
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "forkedFromRepositoryId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepository_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepository_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillRepository_forkedFromRepositoryId_fkey" FOREIGN KEY ("forkedFromRepositoryId") REFERENCES "SkillRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepository_ownerUserId_name_key" ON "SkillRepository"("ownerUserId", "name");
CREATE INDEX "SkillRepository_visibility_status_updatedAt_idx" ON "SkillRepository"("visibility", "status", "updatedAt");
CREATE INDEX "SkillRepository_ownerUserId_updatedAt_idx" ON "SkillRepository"("ownerUserId", "updatedAt");
CREATE INDEX "SkillRepository_forkedFromRepositoryId_idx" ON "SkillRepository"("forkedFromRepositoryId");
CREATE TABLE "SkillRepositoryNameRedirect" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "oldName" VARCHAR(64) NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillRepositoryNameRedirect_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryNameRedirect_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryNameRedirect_ownerUserId_oldName_key" ON "SkillRepositoryNameRedirect"("ownerUserId", "oldName");
CREATE INDEX "SkillRepositoryNameRedirect_repositoryId_idx" ON "SkillRepositoryNameRedirect"("repositoryId");

CREATE TABLE "SkillRepositoryFile" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "path" VARCHAR(1024) NOT NULL,
  "pathKey" VARCHAR(1024) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "mimeType" VARCHAR(255),
  "size" BIGINT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "storageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepositoryFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryFile_repositoryId_pathKey_key" ON "SkillRepositoryFile"("repositoryId", "pathKey");
CREATE INDEX "SkillRepositoryFile_repositoryId_path_idx" ON "SkillRepositoryFile"("repositoryId", "path");
CREATE INDEX "SkillRepositoryFile_sha256_idx" ON "SkillRepositoryFile"("sha256");

CREATE TABLE "SkillRepositoryObjectCleanupTask" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT,
  "storageKey" TEXT NOT NULL,
  "reason" VARCHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepositoryObjectCleanupTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryObjectCleanupTask_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryObjectCleanupTask_storageKey_key" ON "SkillRepositoryObjectCleanupTask"("storageKey");
CREATE INDEX "SkillRepositoryObjectCleanupTask_repositoryId_idx" ON "SkillRepositoryObjectCleanupTask"("repositoryId");

CREATE TABLE "SkillRepositoryInstallEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "clientInstanceId" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillRepositoryInstallEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillRepositoryInstallEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SkillRepositoryInstallEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SkillRepositoryInstallEvent_userId_repositoryId_clientInstanceId_key" ON "SkillRepositoryInstallEvent"("userId", "repositoryId", "clientInstanceId");
CREATE INDEX "SkillRepositoryInstallEvent_repositoryId_idx" ON "SkillRepositoryInstallEvent"("repositoryId");
