CREATE TABLE "SkillRepositoryInstallSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "packageStorageKey" TEXT NOT NULL,
  "packageSha256" VARCHAR(64) NOT NULL,
  "packageSize" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillRepositoryInstallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SkillRepositoryInstallSession_userId_expiresAt_idx"
  ON "SkillRepositoryInstallSession"("userId", "expiresAt");
CREATE INDEX "SkillRepositoryInstallSession_repositoryId_createdAt_idx"
  ON "SkillRepositoryInstallSession"("repositoryId", "createdAt");
CREATE INDEX "SkillRepositoryInstallSession_expiresAt_idx"
  ON "SkillRepositoryInstallSession"("expiresAt");

ALTER TABLE "SkillRepositoryInstallSession"
  ADD CONSTRAINT "SkillRepositoryInstallSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkillRepositoryInstallSession"
  ADD CONSTRAINT "SkillRepositoryInstallSession_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "SkillRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
