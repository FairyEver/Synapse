-- AlterTable
-- Optimistic concurrency base for an overwriting upload: the file version the
-- caller read before uploading and expects to replace. Nullable so existing
-- sessions and callers that do not declare a base keep today's behavior.
ALTER TABLE "DriveUploadSession" ADD COLUMN     "expectedVersionId" VARCHAR(64);
