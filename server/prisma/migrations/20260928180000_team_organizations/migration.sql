CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationMembership" (
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("organizationId","userId")
);

CREATE UNIQUE INDEX "Organization_teamId_name_key" ON "Organization"("teamId","name");
CREATE UNIQUE INDEX "Organization_id_teamId_key" ON "Organization"("id","teamId");
CREATE INDEX "Organization_parentId_teamId_idx" ON "Organization"("parentId","teamId");
CREATE INDEX "OrganizationMembership_teamId_userId_idx" ON "OrganizationMembership"("teamId","userId");

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentId_teamId_fkey" FOREIGN KEY ("parentId","teamId") REFERENCES "Organization"("id","teamId") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_teamId_fkey" FOREIGN KEY ("organizationId","teamId") REFERENCES "Organization"("id","teamId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_teamId_userId_fkey" FOREIGN KEY ("teamId","userId") REFERENCES "TeamMembership"("teamId","userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MailSendPreview" ADD COLUMN "toOrganizationIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MailSendPreview" ADD COLUMN "ccOrganizationIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MailMessage" ADD COLUMN "addressSnapshot" JSONB;
