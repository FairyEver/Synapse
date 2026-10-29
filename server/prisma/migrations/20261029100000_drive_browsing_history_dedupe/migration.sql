-- Keep one row per viewer and target: drop older visits of a link that was opened again.
DELETE FROM "DriveBrowsingHistory" older
USING "DriveBrowsingHistory" newer
WHERE older."viewerId" = newer."viewerId"
  AND older."path" = newer."path"
  AND older."cleared" = false
  AND newer."cleared" = false
  AND (older."visitedAt", older."id") < (newer."visitedAt", newer."id");
