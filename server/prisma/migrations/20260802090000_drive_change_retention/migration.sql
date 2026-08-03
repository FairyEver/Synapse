-- CreateTable
CREATE TABLE "DriveChangeRetentionState" (
    "id" TEXT NOT NULL,
    "purgedThroughSequence" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveChangeRetentionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveChange_occurredAt_idx" ON "DriveChange"("occurredAt");
