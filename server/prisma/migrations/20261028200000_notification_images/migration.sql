CREATE TABLE "NotificationImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "NotificationImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationImage_objectKey_key" ON "NotificationImage"("objectKey");
CREATE INDEX "NotificationImage_userId_idx" ON "NotificationImage"("userId");
CREATE INDEX "NotificationImage_state_expiresAt_idx" ON "NotificationImage"("state", "expiresAt");

ALTER TABLE "UserNotification" ADD COLUMN "imageId" VARCHAR(64);
CREATE UNIQUE INDEX "UserNotification_imageId_key" ON "UserNotification"("imageId");

ALTER TABLE "NotificationImage" ADD CONSTRAINT "NotificationImage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "NotificationImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
