CREATE TABLE "DesktopLoginCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ipAddress" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DesktopLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DesktopLoginCode_codeHash_key" ON "DesktopLoginCode"("codeHash");
CREATE INDEX "DesktopLoginCode_userId_idx" ON "DesktopLoginCode"("userId");
CREATE INDEX "DesktopLoginCode_expiresAt_idx" ON "DesktopLoginCode"("expiresAt");
CREATE INDEX "DesktopLoginCode_usedAt_idx" ON "DesktopLoginCode"("usedAt");

ALTER TABLE "DesktopLoginCode"
  ADD CONSTRAINT "DesktopLoginCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
