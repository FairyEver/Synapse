ALTER TABLE "DriveShare"
  ADD COLUMN "accessSettingsAppliedAt" TIMESTAMP(3);

ALTER TABLE "DrivePublication"
  ADD COLUMN "accessSettingsAppliedAt" TIMESTAMP(3);
