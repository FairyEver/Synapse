CREATE TYPE "TeamEntitlementSource" AS ENUM ('manual', 'plan', 'migration');
CREATE TYPE "TeamAccessRoleKind" AS ENUM ('system', 'custom');

CREATE TABLE "TeamEntitlement" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "source" "TeamEntitlementSource" NOT NULL DEFAULT 'manual',
  "grantedByAdminId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "TeamEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamAccessRole" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" "TeamAccessRoleKind" NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamAccessRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamAccessRolePermission" (
  "id" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamAccessRolePermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMemberAccessRole" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "teamMembershipId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignedByUserId" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamMemberAccessRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamEntitlement_teamId_permissionKey_key" ON "TeamEntitlement"("teamId", "permissionKey");
CREATE INDEX "TeamEntitlement_teamId_idx" ON "TeamEntitlement"("teamId");
CREATE INDEX "TeamEntitlement_permissionKey_idx" ON "TeamEntitlement"("permissionKey");
CREATE INDEX "TeamEntitlement_expiresAt_idx" ON "TeamEntitlement"("expiresAt");
CREATE UNIQUE INDEX "TeamAccessRole_teamId_name_key" ON "TeamAccessRole"("teamId", "name");
CREATE UNIQUE INDEX "TeamAccessRole_teamId_id_key" ON "TeamAccessRole"("teamId", "id");
CREATE INDEX "TeamAccessRole_teamId_idx" ON "TeamAccessRole"("teamId");
CREATE UNIQUE INDEX "TeamAccessRolePermission_roleId_permissionKey_key" ON "TeamAccessRolePermission"("roleId", "permissionKey");
CREATE INDEX "TeamAccessRolePermission_permissionKey_idx" ON "TeamAccessRolePermission"("permissionKey");
CREATE UNIQUE INDEX "TeamMemberAccessRole_teamMembershipId_roleId_key" ON "TeamMemberAccessRole"("teamMembershipId", "roleId");
CREATE INDEX "TeamMemberAccessRole_roleId_idx" ON "TeamMemberAccessRole"("roleId");
CREATE UNIQUE INDEX "TeamMembership_teamId_id_key" ON "TeamMembership"("teamId", "id");

ALTER TABLE "TeamEntitlement" ADD CONSTRAINT "TeamEntitlement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamEntitlement" ADD CONSTRAINT "TeamEntitlement_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TeamAccessRole" ADD CONSTRAINT "TeamAccessRole_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamAccessRolePermission" ADD CONSTRAINT "TeamAccessRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "TeamAccessRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_teamId_teamMembershipId_fkey" FOREIGN KEY ("teamId", "teamMembershipId") REFERENCES "TeamMembership"("teamId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_teamId_roleId_fkey" FOREIGN KEY ("teamId", "roleId") REFERENCES "TeamAccessRole"("teamId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMemberAccessRole" ADD CONSTRAINT "TeamMemberAccessRole_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
