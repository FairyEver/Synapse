CREATE TABLE "DashboardRevokedToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardRevokedToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardRevokedToken_tokenHash_key" ON "DashboardRevokedToken"("tokenHash");
CREATE INDEX "DashboardRevokedToken_expiresAt_idx" ON "DashboardRevokedToken"("expiresAt");
