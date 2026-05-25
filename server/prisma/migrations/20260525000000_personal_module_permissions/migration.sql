DELETE FROM "Invitation" WHERE "type" = 'user_signup';

CREATE TYPE "InvitationType_new" AS ENUM ('team_join');
ALTER TABLE "Invitation"
  ALTER COLUMN "type" TYPE "InvitationType_new"
  USING ("type"::text::"InvitationType_new");
ALTER TYPE "InvitationType" RENAME TO "InvitationType_old";
ALTER TYPE "InvitationType_new" RENAME TO "InvitationType";
DROP TYPE "InvitationType_old";

CREATE TABLE "UserModulePermission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permissionKey" TEXT NOT NULL,
  "grantedByAdminId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserModulePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserModulePermission_userId_permissionKey_key"
  ON "UserModulePermission"("userId", "permissionKey");
CREATE INDEX "UserModulePermission_permissionKey_idx"
  ON "UserModulePermission"("permissionKey");
CREATE INDEX "UserModulePermission_grantedByAdminId_idx"
  ON "UserModulePermission"("grantedByAdminId");

ALTER TABLE "UserModulePermission"
  ADD CONSTRAINT "UserModulePermission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserModulePermission"
  ADD CONSTRAINT "UserModulePermission_grantedByAdminId_fkey"
  FOREIGN KEY ("grantedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "TeamMemberAccessRole";
DROP TABLE IF EXISTS "TeamAccessRolePermission";
DROP TABLE IF EXISTS "TeamAccessRole";
DROP TABLE IF EXISTS "TeamEntitlement";

DROP INDEX IF EXISTS "TeamMembership_teamId_id_key";

DROP TYPE IF EXISTS "TeamAccessRoleKind";
DROP TYPE IF EXISTS "TeamEntitlementSource";
