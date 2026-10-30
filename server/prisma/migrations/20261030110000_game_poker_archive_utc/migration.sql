-- Prisma stores these timestamp columns in UTC without a time zone.
-- Compare against UTC wall time, independent of the database session time zone.

CREATE OR REPLACE FUNCTION "game_poker_immutable_record"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'GamePokerAction' AND TG_OP = 'DELETE'
     AND current_setting('synapse.game.archive_hand', true) = OLD."handId"
     AND EXISTS (SELECT 1 FROM "GamePokerHandArchive" a JOIN "GamePokerHand" h ON h."id"=a."id"
       WHERE a."id"=OLD."handId" AND h."status"='settled'
         AND h."endedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days'
         AND a."data"->'actions' @> jsonb_build_array(to_jsonb(OLD))) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Poker records are immutable outside validated archival';
END;
$$;

CREATE OR REPLACE FUNCTION "game_poker_settled_hand_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD."status"='settled' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Settled poker hands are immutable'; END IF;
    RETURN NEW;
  END IF;
  IF current_setting('synapse.game.archive_hand',true)=OLD."id"
     AND OLD."status"='settled' AND OLD."endedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days'
     AND EXISTS(SELECT 1 FROM "GamePokerHandArchive" a WHERE a."id"=OLD."id" AND a."data"->'hand'=to_jsonb(OLD)-'engineState') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Poker hands can only be removed by validated archival';
END;
$$;

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
  SELECT "id","roomId","handNo","dealerSeat","board","street","pot","status","actionSeq","showdownSeats","engineState","startedAt","endedAt","result" INTO v_hand FROM "GamePokerHand" WHERE "id"=p_hand_id AND "status"='settled'
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
