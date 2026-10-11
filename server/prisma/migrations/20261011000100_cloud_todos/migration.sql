CREATE TYPE "TodoReminderKind" AS ENUM ('none', 'at_due', 'before_due', 'custom');

CREATE TYPE "TodoReminderStatus" AS ENUM ('none', 'pending', 'sent', 'cancelled', 'expired');

CREATE TABLE "TodoItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "reminder" "TodoReminderKind" NOT NULL DEFAULT 'none',
    "offsetMinutes" INTEGER,
    "remindAt" TIMESTAMP(3),
    "reminderGeneration" INTEGER NOT NULL DEFAULT 1,
    "reminderStatus" "TodoReminderStatus" NOT NULL DEFAULT 'none',
    "completedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createRequestId" TEXT NOT NULL,
    "createRequestHash" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TodoMutationReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TodoMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TodoItem_userId_deletedAt_completedAt_dueAt_createdAt_id_idx" ON "TodoItem"("userId", "deletedAt", "completedAt", "dueAt", "createdAt", "id");

CREATE INDEX "TodoItem_reminderStatus_remindAt_idx" ON "TodoItem"("reminderStatus", "remindAt");

CREATE INDEX "TodoItem_deletedAt_idx" ON "TodoItem"("deletedAt");

CREATE UNIQUE INDEX "TodoItem_userId_createRequestId_key" ON "TodoItem"("userId", "createRequestId");

CREATE INDEX "TodoMutationReceipt_expiresAt_idx" ON "TodoMutationReceipt"("expiresAt");

CREATE UNIQUE INDEX "TodoMutationReceipt_userId_clientRequestId_key" ON "TodoMutationReceipt"("userId", "clientRequestId");

ALTER TABLE "TodoItem" ADD CONSTRAINT "TodoItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TodoMutationReceipt" ADD CONSTRAINT "TodoMutationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
