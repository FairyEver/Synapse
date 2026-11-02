-- Permanently retire cloud Skills. Stop the previous API and verify the final database backup first.
-- server/scripts/retire-cloud-skills.cjs must delete COS files before these metadata tables disappear.
-- Fresh databases have no object references and can replay this migration without storage credentials.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SkillRepositoryFile" WHERE "storageKey" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM "SkillRepositoryInstallSession")
    OR EXISTS (SELECT 1 FROM "SkillRepositoryObjectCleanupTask") THEN
    RAISE EXCEPTION 'Run retire-cloud-skills.cjs before deleting cloud Skill metadata';
  END IF;
END $$;

DROP TABLE "SkillRepositoryInstallEvent";
DROP TABLE "SkillRepositoryInstallSession";
DROP TABLE "SkillRepositoryObjectCleanupTask";
DROP TABLE "SkillRepositoryFile";
DROP TABLE "SkillRepositoryNameRedirect";
DROP TABLE "SkillRepository";

COMMIT;
