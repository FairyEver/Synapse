ALTER TABLE "MailMessage"
  ALTER COLUMN "senderId" DROP NOT NULL,
  ALTER COLUMN "teamIdSnapshot" DROP NOT NULL,
  ALTER COLUMN "teamNameSnapshot" DROP NOT NULL;

ALTER TABLE "MailMessage"
  ADD COLUMN "kind" VARCHAR(24) NOT NULL DEFAULT 'user',
  ADD COLUMN "broadcastRequestId" VARCHAR(100);

CREATE UNIQUE INDEX "MailMessage_broadcastRequestId_key" ON "MailMessage"("broadcastRequestId");

ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_platform_broadcast_shape_check"
  CHECK (
    ("kind" = 'user' AND "senderId" IS NOT NULL AND "teamIdSnapshot" IS NOT NULL AND "teamNameSnapshot" IS NOT NULL AND "broadcastRequestId" IS NULL)
    OR
    ("kind" = 'platform_broadcast' AND "senderId" IS NULL AND "teamIdSnapshot" IS NULL AND "teamNameSnapshot" IS NULL AND "broadcastRequestId" IS NOT NULL)
  );
