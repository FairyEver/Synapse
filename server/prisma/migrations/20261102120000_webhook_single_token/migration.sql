-- Product-approved cutover: discard all legacy Webhooks and their history.
-- Prisma records this migration once; normal startup and token rotation never run this cleanup.
-- Restore the pre-deployment database backup to recover deleted legacy data.
BEGIN;
DELETE FROM "WebhookDeliveryReceipt";
DELETE FROM "WebhookDelivery";
DELETE FROM "UserWebhook";

CREATE UNIQUE INDEX "UserWebhook_secretHash_key" ON "UserWebhook"("secretHash");
COMMIT;
