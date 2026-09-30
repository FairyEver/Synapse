CREATE TABLE "DriveMessage" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveMessageComment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "parentCommentId" TEXT,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DriveMessageComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriveMessage_itemId_deletedAt_createdAt_id_idx" ON "DriveMessage"("itemId", "deletedAt", "createdAt", "id");
CREATE INDEX "DriveMessageComment_messageId_deletedAt_createdAt_id_idx" ON "DriveMessageComment"("messageId", "deletedAt", "createdAt", "id");
CREATE INDEX "DriveMessageComment_parentCommentId_idx" ON "DriveMessageComment"("parentCommentId");

ALTER TABLE "DriveMessage" ADD CONSTRAINT "DriveMessage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DriveItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveMessage" ADD CONSTRAINT "DriveMessage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveMessageComment" ADD CONSTRAINT "DriveMessageComment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DriveMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriveMessageComment" ADD CONSTRAINT "DriveMessageComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "DriveMessageComment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriveMessageComment" ADD CONSTRAINT "DriveMessageComment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
