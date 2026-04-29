-- AlterTable
ALTER TABLE "ActivationCode" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ActivationCode_archivedAt_idx" ON "ActivationCode"("archivedAt");
