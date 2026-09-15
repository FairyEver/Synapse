-- AlterTable
ALTER TABLE "DriveChange" ADD COLUMN "previousParentId" TEXT;

-- CreateIndex
CREATE INDEX "DriveChange_userId_previousParentId_sequence_idx" ON "DriveChange"("userId", "previousParentId", "sequence");
