ALTER TABLE "GamePokerRoom" ADD COLUMN "closeRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastMaintainedAt" TIMESTAMP(3);
CREATE INDEX "GamePokerRoom_maintenance_idx" ON "GamePokerRoom"("status", "lastMaintainedAt", "createdAt");
