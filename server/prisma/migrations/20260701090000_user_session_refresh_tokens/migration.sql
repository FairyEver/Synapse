CREATE TABLE "UserSessionRefreshToken" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "replacedAt" TIMESTAMP(3),
    "graceExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSessionRefreshToken_pkey" PRIMARY KEY ("id")
);

INSERT INTO "UserSessionRefreshToken" (
    "id",
    "sessionId",
    "refreshTokenHash",
    "expiresAt",
    "revokedAt",
    "createdAt"
)
SELECT
    "id",
    "id",
    "refreshTokenHash",
    "expiresAt",
    "revokedAt",
    "createdAt"
FROM "UserSession";

CREATE UNIQUE INDEX "UserSessionRefreshToken_refreshTokenHash_key" ON "UserSessionRefreshToken"("refreshTokenHash");
CREATE INDEX "UserSessionRefreshToken_sessionId_idx" ON "UserSessionRefreshToken"("sessionId");
CREATE INDEX "UserSessionRefreshToken_expiresAt_idx" ON "UserSessionRefreshToken"("expiresAt");
CREATE INDEX "UserSessionRefreshToken_revokedAt_idx" ON "UserSessionRefreshToken"("revokedAt");
CREATE INDEX "UserSessionRefreshToken_graceExpiresAt_idx" ON "UserSessionRefreshToken"("graceExpiresAt");

ALTER TABLE "UserSessionRefreshToken"
  ADD CONSTRAINT "UserSessionRefreshToken_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
