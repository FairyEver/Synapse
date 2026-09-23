CREATE TABLE "UserNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "sourceKey" VARCHAR(200),
    "title" VARCHAR(64) NOT NULL,
    "body" VARCHAR(512) NOT NULL,
    "group" VARCHAR(64),
    "url" VARCHAR(2048),
    "level" VARCHAR(20) NOT NULL,
    "targetId" VARCHAR(120),
    "deviceId" VARCHAR(120),
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserNotification_userId_sourceKey_key" ON "UserNotification"("userId", "sourceKey");
CREATE INDEX "UserNotification_userId_deletedAt_createdAt_id_idx" ON "UserNotification"("userId", "deletedAt", "createdAt", "id");
CREATE INDEX "UserNotification_userId_readAt_deletedAt_idx" ON "UserNotification"("userId", "readAt", "deletedAt");
CREATE INDEX "UserNotification_userId_source_deviceId_targetId_resolvedAt_idx" ON "UserNotification"("userId", "source", "deviceId", "targetId", "resolvedAt");
CREATE INDEX "UserNotification_createdAt_idx" ON "UserNotification"("createdAt");
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
