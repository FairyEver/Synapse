-- Additive receipt ordering; existing IDs, read/deleted state and attachments remain intact.
ALTER TABLE "MailRecipient" ADD COLUMN "deliverySequence" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "MailRecipient_deliverySequence_key" ON "MailRecipient"("deliverySequence");
CREATE INDEX "MailRecipient_userId_deletedAt_deliverySequence_idx" ON "MailRecipient"("userId", "deletedAt", "deliverySequence");
