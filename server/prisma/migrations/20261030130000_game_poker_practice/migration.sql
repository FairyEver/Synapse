ALTER TABLE "GameSession" ADD COLUMN "funding" TEXT NOT NULL DEFAULT 'points';
ALTER TABLE "GamePokerRoom" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'points', ADD COLUMN "botActionAt" TIMESTAMP(3);
ALTER TABLE "GamePokerSeat" ADD COLUMN "participantKind" TEXT NOT NULL DEFAULT 'human';
ALTER TABLE "GamePokerHandSeat" ADD COLUMN "participantKind" TEXT NOT NULL DEFAULT 'human';
ALTER TABLE "GamePokerAction" ADD COLUMN "actionSource" TEXT;
CREATE TABLE "GamePokerBot" (
  "id" TEXT PRIMARY KEY, "roomId" TEXT NOT NULL, "seatNo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GamePokerBot_roomId_idx" ON "GamePokerBot"("roomId");
CREATE INDEX "GamePokerRoom_mode_status_botActionAt_idx" ON "GamePokerRoom"("mode","status","botActionAt");
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_funding_check" CHECK (
  "funding" IN ('points','practice') AND
  ("funding" <> 'practice' OR ("buyIn"=0 AND "inPlay"=0 AND ("returned" IS NULL OR "returned"=0)))
);
ALTER TABLE "GamePokerRoom" ADD CONSTRAINT "GamePokerRoom_mode_check" CHECK ("mode" IN ('points','practice'));
ALTER TABLE "GamePokerSeat" ADD CONSTRAINT "GamePokerSeat_kind_check" CHECK ("participantKind" IN ('human','bot'));
ALTER TABLE "GamePokerHandSeat" ADD CONSTRAINT "GamePokerHandSeat_kind_check" CHECK ("participantKind" IN ('human','bot'));
CREATE FUNCTION "game_funding_mode_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='GameSession' THEN
    IF NEW."funding" IS DISTINCT FROM OLD."funding" THEN RAISE EXCEPTION 'Session funding is immutable'; END IF;
  ELSE
    IF NEW."mode" IS DISTINCT FROM OLD."mode" THEN RAISE EXCEPTION 'Poker room mode is immutable'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GameSession_funding_immutable" BEFORE UPDATE ON "GameSession" FOR EACH ROW EXECUTE FUNCTION "game_funding_mode_guard"();
CREATE TRIGGER "GamePokerRoom_mode_immutable" BEFORE UPDATE ON "GamePokerRoom" FOR EACH ROW EXECUTE FUNCTION "game_funding_mode_guard"();
