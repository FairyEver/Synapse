WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "itemId", "userId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "DriveShare"
  WHERE "enabled" = true
)
UPDATE "DriveShare"
SET "enabled" = false,
    "disabledAt" = COALESCE("disabledAt", now())
WHERE "id" IN (
  SELECT "id" FROM ranked WHERE rn > 1
);

CREATE UNIQUE INDEX "DriveShare_active_item_user_key"
  ON "DriveShare"("itemId", "userId")
  WHERE "enabled" = true;
