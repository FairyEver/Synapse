ALTER TABLE "UserSession" ADD COLUMN "sourceSessionId" TEXT;

CREATE INDEX "UserSession_sourceSessionId_idx" ON "UserSession"("sourceSessionId");
