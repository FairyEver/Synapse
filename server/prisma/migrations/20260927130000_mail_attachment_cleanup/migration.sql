ALTER TABLE "MailAttachment" ADD COLUMN "lastReferencedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "MailAttachment_messageId_lastReferencedAt_id_idx" ON "MailAttachment"("messageId", "lastReferencedAt", "id");

CREATE TABLE "MailStorageDeletion" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailStorageDeletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailStorageDeletion_storageKey_key" ON "MailStorageDeletion"("storageKey");
CREATE INDEX "MailStorageDeletion_createdAt_idx" ON "MailStorageDeletion"("createdAt");
