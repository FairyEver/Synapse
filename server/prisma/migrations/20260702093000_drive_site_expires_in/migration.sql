ALTER TABLE "DriveSite"
ADD COLUMN "expiresIn" VARCHAR(16) NOT NULL DEFAULT '30d';

UPDATE "DriveSite"
SET "expiresIn" = CASE
  WHEN "expiresAt" IS NULL THEN 'forever'
  WHEN EXTRACT(EPOCH FROM ("expiresAt" - "updatedAt")) >= 300 * 24 * 60 * 60 THEN '1y'
  WHEN EXTRACT(EPOCH FROM ("expiresAt" - "updatedAt")) >= 18 * 24 * 60 * 60 THEN '30d'
  WHEN EXTRACT(EPOCH FROM ("expiresAt" - "updatedAt")) >= 5 * 24 * 60 * 60 THEN '7d'
  ELSE '3d'
END;
