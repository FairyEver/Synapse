ALTER TABLE "MailMessage" ADD COLUMN "conversationId" VARCHAR(100);
ALTER TABLE "MailMessage" ADD COLUMN "forwardOfId" TEXT;
ALTER TABLE "MailMessage" ADD COLUMN "quoteSnapshot" JSONB;
UPDATE "MailMessage" SET "conversationId" = "id";
ALTER TABLE "MailMessage" ALTER COLUMN "conversationId" SET NOT NULL;
CREATE INDEX "MailMessage_conversationId_sentAt_id_idx" ON "MailMessage"("conversationId", "sentAt", "id");

ALTER TABLE "MailRecipient" ADD COLUMN "role" VARCHAR(2) NOT NULL DEFAULT 'to';

ALTER TABLE "MailSendPreview" ADD COLUMN "ccIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MailSendPreview" ADD COLUMN "formatVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MailSendPreview" ADD COLUMN "forwardOfId" TEXT;
ALTER TABLE "MailSendPreview" ADD COLUMN "conversationId" VARCHAR(100);
ALTER TABLE "MailSendPreview" ADD COLUMN "quoteSnapshot" JSONB;
UPDATE "MailSendPreview" SET "conversationId" = "id";
ALTER TABLE "MailSendPreview" ALTER COLUMN "conversationId" SET NOT NULL;
