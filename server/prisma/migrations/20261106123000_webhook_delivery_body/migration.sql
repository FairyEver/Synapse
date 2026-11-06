-- New deliveries keep the complete sanitized automation payload. Historical
-- previews cannot be reconstructed; nullable columns intentionally stay null.
ALTER TABLE "WebhookDelivery"
  ADD COLUMN "bodyText" TEXT,
  ADD COLUMN "bodySha256" TEXT,
  ADD COLUMN "bodyBytes" INTEGER,
  ADD COLUMN "bodyContentType" TEXT,
  ADD COLUMN "payloadVersion" INTEGER;
