-- AlterTable
ALTER TABLE "ActivationCode" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_code_key" ON "ActivationCode"("code");
