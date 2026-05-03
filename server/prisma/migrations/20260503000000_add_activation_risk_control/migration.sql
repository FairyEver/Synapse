-- CreateEnum
CREATE TYPE "ActivationAttemptOutcome" AS ENUM ('success', 'invalid_code', 'bound_conflict', 'rate_limited', 'risk_locked', 'device_limit', 'blocked');

-- AlterTable
ALTER TABLE "ActivationCode" ADD COLUMN "riskLockedAt" TIMESTAMP(3),
ADD COLUMN "riskLockedReason" TEXT,
ADD COLUMN "riskUnlockedAt" TIMESTAMP(3),
ADD COLUMN "riskReviewNote" TEXT,
ADD COLUMN "replacedByActivationCodeId" TEXT;

-- CreateTable
CREATE TABLE "ActivationAttempt" (
    "id" TEXT NOT NULL,
    "activationCodeId" TEXT,
    "activationCodeHash" TEXT NOT NULL,
    "activationCodeHint" TEXT,
    "email" TEXT NOT NULL,
    "deviceIdHash" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "outcome" "ActivationAttemptOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivationCode_riskLockedAt_idx" ON "ActivationCode"("riskLockedAt");

-- CreateIndex
CREATE INDEX "ActivationCode_replacedByActivationCodeId_idx" ON "ActivationCode"("replacedByActivationCodeId");

-- CreateIndex
CREATE INDEX "ActivationAttempt_createdAt_idx" ON "ActivationAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "ActivationAttempt_activationCodeHash_createdAt_idx" ON "ActivationAttempt"("activationCodeHash", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationAttempt_activationCodeId_createdAt_idx" ON "ActivationAttempt"("activationCodeId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationAttempt_email_createdAt_idx" ON "ActivationAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationAttempt_deviceIdHash_createdAt_idx" ON "ActivationAttempt"("deviceIdHash", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationAttempt_ipAddress_createdAt_idx" ON "ActivationAttempt"("ipAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "ActivationCode" ADD CONSTRAINT "ActivationCode_replacedByActivationCodeId_fkey" FOREIGN KEY ("replacedByActivationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivationAttempt" ADD CONSTRAINT "ActivationAttempt_activationCodeId_fkey" FOREIGN KEY ("activationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
