ALTER TABLE "UserWebhook"
  ADD COLUMN "secret" TEXT;

CREATE TABLE "WebhookDeliveryReceipt" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "clientInstanceId" TEXT NOT NULL,
  "deviceName" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,

  CONSTRAINT "WebhookDeliveryReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookDeliveryReceipt_deliveryId_clientInstanceId_key"
  ON "WebhookDeliveryReceipt"("deliveryId", "clientInstanceId");

CREATE INDEX "WebhookDeliveryReceipt_deliveryId_sentAt_idx"
  ON "WebhookDeliveryReceipt"("deliveryId", "sentAt");

ALTER TABLE "WebhookDeliveryReceipt"
  ADD CONSTRAINT "WebhookDeliveryReceipt_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
