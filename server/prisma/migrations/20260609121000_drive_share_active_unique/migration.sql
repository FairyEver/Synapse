CREATE UNIQUE INDEX "DriveShare_active_item_user_key"
  ON "DriveShare"("itemId", "userId")
  WHERE "enabled" = true;
