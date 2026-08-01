-- This migration must only run after a restorable database backup has been created and verified.
-- Rolling back to a pre-migration release requires restoring both that backup and the previous ENV.

CREATE TYPE "InvitationCreatorType" AS ENUM ('platform_admin', 'user');
CREATE TYPE "AuditActorType" AS ENUM ('user', 'platform_admin', 'system', 'unknown');

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE INDEX "AdminSession_revokedAt_idx" ON "AdminSession"("revokedAt");

ALTER TABLE "Invitation" ADD COLUMN "createdByType" "InvitationCreatorType";

UPDATE "Invitation"
SET "createdByType" = CASE
    WHEN "createdByAdminId" IS NOT NULL THEN 'platform_admin'::"InvitationCreatorType"
    WHEN "createdByUserId" IS NOT NULL THEN 'user'::"InvitationCreatorType"
    ELSE NULL
END;

ALTER TABLE "AuditLog"
    ADD COLUMN "actorType" "AuditActorType",
    ADD COLUMN "actorId" TEXT,
    ADD COLUMN "actorLabel" TEXT,
    ADD COLUMN "adminSessionId" TEXT;

-- AdminUser email addresses could not also belong to User records. This join is therefore the
-- only legacy signal strong enough to delete old administrator authentication and operation logs.
DELETE FROM "AuditLog" AS audit
USING "AdminUser" AS admin_user
WHERE LOWER(audit."adminEmail") = LOWER(admin_user."email");

UPDATE "AuditLog" AS audit
SET
    "actorType" = 'user'::"AuditActorType",
    "actorId" = app_user."id",
    "actorLabel" = app_user."email"
FROM "User" AS app_user
WHERE LOWER(audit."adminEmail") = LOWER(app_user."email")
   OR audit."adminEmail" = app_user."id";

UPDATE "AuditLog"
SET
    "actorType" = 'system'::"AuditActorType",
    "actorLabel" = '系统'
WHERE "actorType" IS NULL
  AND LOWER("adminEmail") = 'system';

-- Ambiguous legacy rows are retained rather than guessed or deleted.
UPDATE "AuditLog"
SET
    "actorType" = 'unknown'::"AuditActorType",
    "actorLabel" = COALESCE(NULLIF("adminEmail", ''), '未知主体')
WHERE "actorType" IS NULL;

ALTER TABLE "AuditLog"
    ALTER COLUMN "actorType" SET NOT NULL,
    ALTER COLUMN "actorLabel" SET NOT NULL,
    DROP COLUMN "adminEmail";

CREATE INDEX "AuditLog_actorType_createdAt_idx" ON "AuditLog"("actorType", "createdAt");
CREATE INDEX "AuditLog_adminSessionId_createdAt_idx" ON "AuditLog"("adminSessionId", "createdAt");

ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_createdByAdminId_fkey";
ALTER TABLE "Invitation" DROP COLUMN "createdByAdminId";

DROP INDEX "UserModulePermission_grantedByAdminId_idx";
ALTER TABLE "UserModulePermission" DROP CONSTRAINT "UserModulePermission_grantedByAdminId_fkey";
ALTER TABLE "UserModulePermission" DROP COLUMN "grantedByAdminId";

DROP TABLE "DashboardRevokedToken";
DROP TABLE "AdminUser";
DROP TYPE "AdminStatus";
