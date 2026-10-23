-- Preserve delivery identity, per-user state, and arbitrary user-authored URLs.
UPDATE "UserNotification"
SET "source" = 'mail-internal',
    "group" = CASE WHEN "group" = 'mail' THEN 'mail-internal' ELSE "group" END,
    "url" = CASE
      WHEN "url" = 'synapse://mail/' || "targetId"
        THEN 'synapse://mail-internal/' || "targetId"
      ELSE "url"
    END
WHERE "source" = 'mail';
