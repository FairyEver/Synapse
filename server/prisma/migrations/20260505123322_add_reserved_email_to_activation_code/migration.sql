-- DropIndex
DROP INDEX "ActivationCode_archivedAt_idx";

-- AlterTable
ALTER TABLE "ActivationCode" ADD COLUMN     "reservedEmail" TEXT;
