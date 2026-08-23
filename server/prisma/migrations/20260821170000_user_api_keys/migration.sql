CREATE TABLE "UserApiKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "keyHash" VARCHAR(64) NOT NULL,
  "keyPrefix" VARCHAR(24) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserApiKey_keyHash_key" ON "UserApiKey"("keyHash");
CREATE INDEX "UserApiKey_userId_revokedAt_createdAt_idx" ON "UserApiKey"("userId", "revokedAt", "createdAt");

ALTER TABLE "UserApiKey"
  ADD CONSTRAINT "UserApiKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
