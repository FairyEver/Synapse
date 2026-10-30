ALTER TABLE "GamePokerRoom"
  ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'standard52',
  ADD COLUMN "nextHandAt" TIMESTAMP(3),
  ADD CONSTRAINT "GamePokerRoom_variant_check" CHECK ("variant" IN ('standard52','short32')),
  ADD CONSTRAINT "GamePokerRoom_blind_check" CHECK (("smallBlind","bigBlind") IN ((1,2),(2,4),(5,10),(10,20)));
CREATE INDEX "GamePokerRoom_nextHandAt_id_idx" ON "GamePokerRoom"("nextHandAt","id");
ALTER TABLE "GamePokerSeat"
  ADD COLUMN "controller" TEXT NOT NULL DEFAULT 'ai',
  ADD COLUMN "controlVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "handoffPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseReason" TEXT,
  ADD COLUMN "checkpoint" JSONB,
  ADD CONSTRAINT "GamePokerSeat_controller_check" CHECK ("controller" IN ('human','ai')),
  ADD CONSTRAINT "GamePokerSeat_controlVersion_check" CHECK ("controlVersion" >= 0),
  ADD CONSTRAINT "GamePokerSeat_pauseReason_check" CHECK ("pauseReason" IS NULL OR "pauseReason" IN ('user','context_maintenance'));
ALTER TABLE "GamePokerHand" ADD COLUMN "rules" JSONB;

CREATE FUNCTION "game_poker_preserve_room_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."variant",NEW."smallBlind",NEW."bigBlind") IS DISTINCT FROM
     (OLD."variant",OLD."smallBlind",OLD."bigBlind") THEN
    RAISE EXCEPTION 'Poker room rules are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GamePokerRoom_preserve_rules" BEFORE UPDATE ON "GamePokerRoom"
FOR EACH ROW EXECUTE FUNCTION "game_poker_preserve_room_rules"();

-- Preserve complete immutable rule snapshots in cold storage.
CREATE OR REPLACE FUNCTION "game_poker_archive_hand"(p_hand_id TEXT,p_cutoff TIMESTAMP) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_room_id TEXT;
  v_room_status TEXT;
  v_current_hand TEXT;
  v_hand "GamePokerHand"%ROWTYPE;
  v_data JSONB;
  v_stored JSONB;
  v_users TEXT[];
BEGIN
  SELECT "roomId" INTO v_room_id FROM "GamePokerHand" WHERE "id"=p_hand_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT "status","currentHandId" INTO v_room_status,v_current_hand FROM "GamePokerRoom" WHERE "id"=v_room_id FOR UPDATE;
  SELECT * INTO v_hand FROM "GamePokerHand" WHERE "id"=p_hand_id AND "status"='settled'
    AND "endedAt" <= LEAST(p_cutoff,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days') FOR UPDATE;
  IF NOT FOUND OR (v_room_status='running' AND v_current_hand=p_hand_id) THEN RETURN false; END IF;
  SELECT array_agg(DISTINCT "userId" ORDER BY "userId") INTO v_users FROM "GamePokerHandSeat" WHERE "handId"=p_hand_id;
  v_data := jsonb_build_object(
    'hand',to_jsonb(v_hand)-'engineState',
    'seats',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSeat" s WHERE s."handId"=p_hand_id),'[]'),
    'actions',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."seq") FROM "GamePokerAction" a WHERE a."handId"=p_hand_id),'[]'),
    'summaries',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSummary" s WHERE s."handId"=p_hand_id),'[]')
  );
  INSERT INTO "GamePokerActionReceipt"("actionId","userId","roomId","response","createdAt")
    SELECT "actionId","userId","roomId","response","createdAt" FROM "GamePokerAction" WHERE "handId"=p_hand_id
    ON CONFLICT("actionId") DO NOTHING;
  IF EXISTS(SELECT 1 FROM "GamePokerAction" a JOIN "GamePokerActionReceipt" r ON a."actionId"=r."actionId"
    WHERE a."handId"=p_hand_id AND (a."userId"<>r."userId" OR a."roomId"<>r."roomId" OR a."response" IS DISTINCT FROM r."response")) THEN
    RAISE EXCEPTION 'Poker receipt does not match archival source';
  END IF;
  INSERT INTO "GamePokerHandArchive"("id","roomId","handNo","participantIds","data","endedAt")
    VALUES(v_hand."id",v_hand."roomId",v_hand."handNo",v_users,v_data,v_hand."endedAt") ON CONFLICT("id") DO NOTHING;
  SELECT "data" INTO v_stored FROM "GamePokerHandArchive" WHERE "id"=p_hand_id;
  IF v_stored IS DISTINCT FROM v_data THEN RAISE EXCEPTION 'Poker archive does not match hot records'; END IF;
  PERFORM set_config('synapse.game.archive_hand',p_hand_id,true);
  DELETE FROM "GamePokerAction" WHERE "handId"=p_hand_id;
  DELETE FROM "GamePokerHandSeat" WHERE "handId"=p_hand_id;
  DELETE FROM "GamePokerHandSummary" WHERE "handId"=p_hand_id;
  IF v_current_hand=p_hand_id THEN UPDATE "GamePokerRoom" SET "currentHandId"=NULL WHERE "id"=v_room_id; END IF;
  DELETE FROM "GamePokerHand" WHERE "id"=p_hand_id;
  PERFORM set_config('synapse.game.archive_hand','',true);
  RETURN true;
END;
$$;
