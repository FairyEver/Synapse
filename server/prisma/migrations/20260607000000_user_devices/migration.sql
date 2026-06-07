CREATE TABLE "UserDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientInstanceId" TEXT NOT NULL,
  "displayName" VARCHAR(120),
  "deviceName" VARCHAR(120) NOT NULL,
  "platform" VARCHAR(80) NOT NULL,
  "appVersion" VARCHAR(80) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserDevice_userId_clientInstanceId_key"
  ON "UserDevice"("userId", "clientInstanceId");

CREATE INDEX "UserDevice_userId_lastSeenAt_idx"
  ON "UserDevice"("userId", "lastSeenAt");

CREATE INDEX "UserDevice_lastSeenAt_idx"
  ON "UserDevice"("lastSeenAt");

ALTER TABLE "UserDevice"
  ADD CONSTRAINT "UserDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
