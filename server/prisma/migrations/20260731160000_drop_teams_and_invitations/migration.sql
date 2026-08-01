-- This migration permanently removes the team and team invitation product domain.
-- Apply it only after creating and verifying a restorable database backup.

DELETE FROM "AuditLog"
WHERE "targetType" IN ('team', 'invitation')
   OR "action" LIKE 'team.%'
   OR "action" LIKE 'teams.%'
   OR "action" LIKE 'admin.team%'
   OR "action" LIKE 'admin.invitation%';

DROP TABLE "Invitation";
DROP TABLE "TeamMembership";
DROP TABLE "Team";

DROP TYPE "InvitationCreatorType";
DROP TYPE "InvitationType";
DROP TYPE "TeamRole";
