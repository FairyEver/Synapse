ALTER TABLE "DriveAnnotationThread"
ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'open';

ALTER TABLE "DriveAnnotationThread"
ADD CONSTRAINT "DriveAnnotationThread_status_check" CHECK ("status" IN ('open', 'resolved'));
