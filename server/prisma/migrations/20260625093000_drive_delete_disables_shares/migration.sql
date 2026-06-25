UPDATE "DriveShare" AS ds
SET
  "enabled" = false,
  "disabledAt" = COALESCE(ds."disabledAt", NOW())
FROM "DriveItem" AS di
WHERE ds."itemId" = di."id"
  AND ds."enabled" = true
  AND (
    di."deletedAt" IS NOT NULL
    OR di."lifecycleStatus" <> 'active'
    OR di."storageStatus" <> 'active'
    OR EXISTS (
      SELECT 1
      FROM "PublicAsset" AS pa
      WHERE pa."itemId" = di."id"
    )
  );
