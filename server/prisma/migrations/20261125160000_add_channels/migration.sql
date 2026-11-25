-- AlterTable
ALTER TABLE "UserApiKey"
ADD COLUMN "channelAccessMode" VARCHAR(16) DEFAULT 'selected',
ADD COLUMN "channelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "seqEpoch" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Channel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelToken" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "tokenPrefix" VARCHAR(24) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelToken_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "ChannelToken_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelRetainedEvent" (
    "channelId" TEXT NOT NULL,
    "event" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "seq" BIGINT NOT NULL,
    "senderClientId" VARCHAR(64),
    "senderName" VARCHAR(64),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRetainedEvent_pkey" PRIMARY KEY ("channelId", "event"),
    CONSTRAINT "ChannelRetainedEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Channel_ownerId_createdAt_idx" ON "Channel"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelToken_channelId_revokedAt_createdAt_idx" ON "ChannelToken"("channelId", "revokedAt", "createdAt");
