CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "teamIdSnapshot" TEXT NOT NULL,
    "teamNameSnapshot" VARCHAR(30) NOT NULL,
    "subject" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "clientRequestId" VARCHAR(100) NOT NULL,
    "previewId" TEXT NOT NULL,
    "senderDeletedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MailRecipient" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MailRecipient_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MailDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientIds" JSONB NOT NULL,
    "subject" VARCHAR(120) NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "attachmentIds" JSONB NOT NULL,
    "replyToId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MailDraft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MailSendPreview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientIds" JSONB NOT NULL,
    "attachmentIds" JSONB NOT NULL,
    "teamIdSnapshot" TEXT NOT NULL,
    "teamNameSnapshot" VARCHAR(30) NOT NULL,
    "subject" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailSendPreview_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MailAttachment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(255),
    "size" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sourceItemId" TEXT,
    "sourceVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAttachment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MailMessage_senderId_clientRequestId_key" ON "MailMessage"("senderId", "clientRequestId");
CREATE UNIQUE INDEX "MailMessage_previewId_key" ON "MailMessage"("previewId");
CREATE INDEX "MailMessage_senderId_senderDeletedAt_sentAt_id_idx" ON "MailMessage"("senderId", "senderDeletedAt", "sentAt", "id");
CREATE INDEX "MailMessage_teamIdSnapshot_sentAt_idx" ON "MailMessage"("teamIdSnapshot", "sentAt");
CREATE UNIQUE INDEX "MailRecipient_messageId_userId_key" ON "MailRecipient"("messageId", "userId");
CREATE INDEX "MailRecipient_userId_deletedAt_messageId_idx" ON "MailRecipient"("userId", "deletedAt", "messageId");
CREATE INDEX "MailDraft_userId_updatedAt_idx" ON "MailDraft"("userId", "updatedAt");
CREATE INDEX "MailSendPreview_userId_expiresAt_idx" ON "MailSendPreview"("userId", "expiresAt");
CREATE UNIQUE INDEX "MailAttachment_storageKey_key" ON "MailAttachment"("storageKey");
CREATE INDEX "MailAttachment_ownerId_messageId_createdAt_idx" ON "MailAttachment"("ownerId", "messageId", "createdAt");
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailRecipient" ADD CONSTRAINT "MailRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailRecipient" ADD CONSTRAINT "MailRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailDraft" ADD CONSTRAINT "MailDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailSendPreview" ADD CONSTRAINT "MailSendPreview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MailAttachment" ADD CONSTRAINT "MailAttachment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailAttachment" ADD CONSTRAINT "MailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
