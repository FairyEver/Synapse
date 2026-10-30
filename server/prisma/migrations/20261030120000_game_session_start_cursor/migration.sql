-- Games own the interpretation of this internal participation boundary.
-- It is not a credential and is not projected by the hall API.
ALTER TABLE "GameSession" ADD COLUMN "startCursor" TEXT;

-- Preserve the exact boundary of seats already present during upgrade.
-- Closed legacy sessions without a seat retain the timestamp fallback.
UPDATE "GameSession" AS session
SET "startCursor" = seat."joinedHandNo"::text
FROM "GamePokerSeat" AS seat
WHERE session."gameKind" = 'poker'
  AND session."gameRoomId" = seat."roomId"
  AND session."userId" = seat."userId"
  AND session."status" <> 'closed'
  AND seat."joinedHandNo" IS NOT NULL;
