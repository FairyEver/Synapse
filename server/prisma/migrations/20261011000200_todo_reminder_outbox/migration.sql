-- CreateEnum
CREATE TYPE "TodoDeliveryStatus" AS ENUM ('pending', 'delivered', 'skipped', 'expired');

-- CreateTable
CREATE TABLE "TodoReminderDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "todoId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "notificationId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "status" "TodoDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TodoReminderDelivery_notificationId_key" ON "TodoReminderDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "TodoReminderDelivery_status_nextAttemptAt_leaseUntil_idx" ON "TodoReminderDelivery"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "TodoReminderDelivery_createdAt_idx" ON "TodoReminderDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TodoReminderDelivery_todoId_generation_key" ON "TodoReminderDelivery"("todoId", "generation");

-- AddForeignKey
ALTER TABLE "TodoReminderDelivery" ADD CONSTRAINT "TodoReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoReminderDelivery" ADD CONSTRAINT "TodoReminderDelivery_todoId_fkey" FOREIGN KEY ("todoId") REFERENCES "TodoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TodoReminderDelivery" ADD CONSTRAINT "TodoReminderDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "UserNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
