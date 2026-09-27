CREATE TABLE "MailNotificationOutbox" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailNotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailNotificationOutbox_messageId_recipientId_key" ON "MailNotificationOutbox"("messageId", "recipientId");
CREATE INDEX "MailNotificationOutbox_createdAt_idx" ON "MailNotificationOutbox"("createdAt");
ALTER TABLE "MailNotificationOutbox" ADD CONSTRAINT "MailNotificationOutbox_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
