-- 部署注意：本迁移会给现有 "UserNotification" 表新增可空列 "imageId"，并立刻在其上
-- 建唯一索引 "UserNotification_imageId_key"。这一列在本迁移完成前不存在，对现有行全部为
-- NULL，但 PostgreSQL 建索引时仍会短暂阻塞该表的写入（获取 SHARE 级锁，等已有事务结束）。
-- 因此发布前必须先确认 "UserNotification" 当前行数（SELECT count(*)），并在数据库窗口
-- 允许短暂写入阻塞后再执行；部署脚本必须带 ALLOW_RISKY_MIGRATIONS=1 才能放行这一条。
-- 不要为了绕开扫描把索引改成非唯一：一张图片只能挂一条通知，唯一性本来就是约束的一部分。

CREATE TABLE "NotificationImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(64) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "NotificationImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationImage_objectKey_key" ON "NotificationImage"("objectKey");
CREATE INDEX "NotificationImage_userId_idx" ON "NotificationImage"("userId");
CREATE INDEX "NotificationImage_state_expiresAt_idx" ON "NotificationImage"("state", "expiresAt");

ALTER TABLE "UserNotification" ADD COLUMN "imageId" VARCHAR(64);
CREATE UNIQUE INDEX "UserNotification_imageId_key" ON "UserNotification"("imageId");

ALTER TABLE "NotificationImage" ADD CONSTRAINT "NotificationImage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_imageId_fkey"
  FOREIGN KEY ("imageId") REFERENCES "NotificationImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
