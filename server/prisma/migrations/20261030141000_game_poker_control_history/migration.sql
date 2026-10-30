CREATE TABLE "GamePokerControlHistory" (
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "controlVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("controlVersion" >= 0),
  "joinPending" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("roomId", "userId")
);
INSERT INTO "GamePokerControlHistory"("roomId","userId","controlVersion")
  SELECT "roomId","userId","controlVersion" FROM "GamePokerSeat"
  WHERE "participantKind" <> 'bot' AND ("controller"='human' OR "controlVersion">0);

CREATE FUNCTION "game_poker_preserve_hand_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."rules" IS NOT NULL AND NEW."rules" IS DISTINCT FROM OLD."rules" THEN
    RAISE EXCEPTION 'Poker hand rules are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GamePokerHand_preserve_rules" BEFORE UPDATE ON "GamePokerHand"
FOR EACH ROW EXECUTE FUNCTION "game_poker_preserve_hand_rules"();
