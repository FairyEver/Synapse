ALTER TABLE "DrivePublication" DROP CONSTRAINT IF EXISTS "DrivePublication_currentDeploymentId_id_fkey";

DROP TABLE IF EXISTS "DrivePublicationAsset";
DROP TABLE IF EXISTS "DrivePublicationDeployment";
DROP TABLE IF EXISTS "DrivePublication";
