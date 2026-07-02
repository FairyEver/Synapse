CREATE UNIQUE INDEX "SkillRepository_legacyContentStoreItemId_key"
  ON "SkillRepository"("legacyContentStoreItemId")
  WHERE "legacyContentStoreItemId" IS NOT NULL;
