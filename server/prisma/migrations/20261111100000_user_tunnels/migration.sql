-- New tunnel domain only. Retired labels remain reserved by their original rows.
CREATE TABLE "UserTunnel" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "clientInstanceId" VARCHAR(128) NOT NULL,
    "label" VARCHAR(32) NOT NULL, "port" INTEGER NOT NULL CHECK ("port" BETWEEN 1 AND 65535),
    "enabled" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "UserTunnel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserTunnel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserTunnel_label_key" ON "UserTunnel"("label");
CREATE INDEX "UserTunnel_userId_clientInstanceId_deletedAt_createdAt_idx" ON "UserTunnel"("userId", "clientInstanceId", "deletedAt", "createdAt");
CREATE INDEX "UserTunnel_userId_deletedAt_idx" ON "UserTunnel"("userId", "deletedAt");
CREATE TABLE "UserTunnelOperation" (
    "userId" TEXT NOT NULL, "requestId" VARCHAR(36) NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
    "mappingId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTunnelOperation_pkey" PRIMARY KEY ("userId", "requestId"),
    CONSTRAINT "UserTunnelOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserTunnelOperation_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "UserTunnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "TunnelDeviceCredential" (
    "userId" TEXT NOT NULL, "clientInstanceId" VARCHAR(128) NOT NULL, "keyHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TunnelDeviceCredential_pkey" PRIMARY KEY ("userId", "clientInstanceId"),
    CONSTRAINT "TunnelDeviceCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
