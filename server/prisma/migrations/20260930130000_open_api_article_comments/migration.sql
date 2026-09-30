ALTER TABLE "DriveMessage" ADD COLUMN "openApiIdempotencyHash" VARCHAR(64);
ALTER TABLE "DriveMessage" ADD COLUMN "openApiRequestHash" VARCHAR(64);

CREATE UNIQUE INDEX "DriveMessage_openApiIdempotencyHash_key" ON "DriveMessage"("openApiIdempotencyHash");
