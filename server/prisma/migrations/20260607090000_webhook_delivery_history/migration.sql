ALTER TABLE "UserWebhook"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "WebhookDelivery"
  ADD COLUMN "webhookPublicId" TEXT,
  ADD COLUMN "webhookName" TEXT;

UPDATE "WebhookDelivery" AS delivery
SET
  "webhookPublicId" = webhook."publicId",
  "webhookName" = webhook."name"
FROM "UserWebhook" AS webhook
WHERE delivery."webhookId" = webhook."id";

ALTER TABLE "WebhookDelivery"
  ALTER COLUMN "webhookPublicId" SET NOT NULL,
  ALTER COLUMN "webhookName" SET NOT NULL;

CREATE INDEX "UserWebhook_userId_deletedAt_createdAt_idx"
  ON "UserWebhook"("userId", "deletedAt", "createdAt");

CREATE INDEX "WebhookDelivery_status_receivedAt_idx"
  ON "WebhookDelivery"("status", "receivedAt");

ALTER TABLE "WebhookDelivery"
  DROP CONSTRAINT "WebhookDelivery_webhookId_fkey";

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "UserWebhook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
