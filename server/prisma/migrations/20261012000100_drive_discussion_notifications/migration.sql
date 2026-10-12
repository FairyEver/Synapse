ALTER TABLE "DriveAnnotationThread" ADD COLUMN "sourceShareId" TEXT;
ALTER TABLE "DriveAnnotationComment" ADD COLUMN "sourceShareId" TEXT;
ALTER TABLE "DriveMessage" ADD COLUMN "sourceShareId" TEXT;
ALTER TABLE "DriveMessageComment" ADD COLUMN "sourceShareId" TEXT;

CREATE TABLE "DriveDiscussionNotificationTarget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "notificationId" TEXT NOT NULL UNIQUE REFERENCES "UserNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemId" TEXT NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "threadId" TEXT,
  "messageId" TEXT,
  "commentId" TEXT,
  "sourceShareId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriveDiscussionNotificationTarget_shape" CHECK (
    "action" IN ('created', 'replied') AND (
      ("kind" = 'annotation' AND "threadId" IS NOT NULL AND "commentId" IS NOT NULL AND "messageId" IS NULL) OR
      ("kind" = 'message' AND "messageId" IS NOT NULL AND "threadId" IS NULL AND ("action" = 'created' OR "commentId" IS NOT NULL))
    )
  )
);
CREATE TABLE "DriveDiscussionNotificationDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "notificationId" TEXT NOT NULL UNIQUE REFERENCES "UserNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "failureReason" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DriveDiscussionNotificationDelivery_status" CHECK ("status" IN ('pending','delivered','skipped','expired'))
);
CREATE INDEX "DriveDiscussionNotificationDelivery_claim_idx" ON "DriveDiscussionNotificationDelivery"("status","nextAttemptAt","leaseUntil");
CREATE INDEX "DriveDiscussionNotificationDelivery_createdAt_idx" ON "DriveDiscussionNotificationDelivery"("createdAt");
