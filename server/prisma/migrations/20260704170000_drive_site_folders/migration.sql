CREATE TABLE "DriveSiteFolder" (
  "id" TEXT NOT NULL,
  "driveSiteId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "sourceItemId" TEXT,
  "relativePath" VARCHAR(1024) NOT NULL,
  CONSTRAINT "DriveSiteFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveSiteFolder_deploymentId_relativePath_key" ON "DriveSiteFolder"("deploymentId", "relativePath");
CREATE INDEX "DriveSiteFolder_driveSiteId_deploymentId_idx" ON "DriveSiteFolder"("driveSiteId", "deploymentId");
CREATE INDEX "DriveSiteFolder_sourceItemId_idx" ON "DriveSiteFolder"("sourceItemId");

ALTER TABLE "DriveSiteFolder"
ADD CONSTRAINT "DriveSiteFolder_driveSiteId_fkey"
FOREIGN KEY ("driveSiteId") REFERENCES "DriveSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveSiteFolder"
ADD CONSTRAINT "DriveSiteFolder_deploymentId_fkey"
FOREIGN KEY ("deploymentId") REFERENCES "DriveSiteDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
