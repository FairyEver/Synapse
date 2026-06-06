CREATE TABLE "UserWebhook" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "secretHash" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserWebhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "query" JSONB NOT NULL,
  "headers" JSONB NOT NULL,
  "bodyKind" TEXT NOT NULL,
  "bodySize" INTEGER NOT NULL,
  "bodyPreview" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "onlineClientCount" INTEGER NOT NULL,
  "sentClientCount" INTEGER NOT NULL,
  "failedClientCount" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,

  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserWebhook_publicId_key" ON "UserWebhook"("publicId");
CREATE INDEX "UserWebhook_userId_createdAt_idx" ON "UserWebhook"("userId", "createdAt");
CREATE INDEX "WebhookDelivery_webhookId_receivedAt_idx" ON "WebhookDelivery"("webhookId", "receivedAt");
CREATE INDEX "WebhookDelivery_userId_receivedAt_idx" ON "WebhookDelivery"("userId", "receivedAt");

ALTER TABLE "UserWebhook"
  ADD CONSTRAINT "UserWebhook_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "UserWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
