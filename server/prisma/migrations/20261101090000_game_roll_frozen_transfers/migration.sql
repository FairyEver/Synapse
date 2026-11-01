-- Generated only; apply through the normal migration release process, never from this task.
ALTER TABLE "GamePokerRoom" ADD COLUMN "ruleOptions" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "rollPricingVersion" TEXT;
ALTER TABLE "GameSession" ADD COLUMN "admissionId" TEXT;
UPDATE "GameSession" g SET "admissionId"=s."id" FROM "GamePokerSeat" s
WHERE g."gameKind"='poker' AND g."status"<>'closed' AND g."userId"=s."userId" AND g."gameRoomId"=s."roomId";
-- Closed sessions have no historical Roll assets. Never infer historical hand identity from time.
UPDATE "GameSession" SET "admissionId"=gen_random_uuid()::text WHERE "admissionId" IS NULL;
ALTER TABLE "GameSession" ALTER COLUMN "admissionId" SET NOT NULL;
ALTER TABLE "GamePokerHandSeat" ADD COLUMN "admissionId" TEXT, ADD COLUMN "originalHoleCards" JSONB;
ALTER TABLE "GamePokerAction" ADD COLUMN "rollId" TEXT;
ALTER TABLE "GamePokerActionReceipt" ADD COLUMN "requestHash" TEXT;
CREATE TABLE "GamePendingTransfer" (
  "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL, "gameKind" TEXT NOT NULL,
  "gameRoomId" TEXT NOT NULL, "settlementId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL, "funding" TEXT NOT NULL, "amount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "releasedTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "releasedAt" TIMESTAMP(3),
  CONSTRAINT "GamePendingTransfer_amount_check" CHECK ("amount">0),
  CONSTRAINT "GamePendingTransfer_funding_check" CHECK ("funding" IN ('points','practice')),
  CONSTRAINT "GamePendingTransfer_status_check" CHECK (
    ("status"='pending' AND "releasedTo" IS NULL AND "releasedAt" IS NULL) OR
    ("status"='released' AND "releasedTo" IS NOT NULL AND "releasedTo" IN ('table','account') AND "releasedAt" IS NOT NULL AND ("releasedTo"<>'account' OR "funding"='points')) OR
    ("status"='voided' AND "releasedTo" IS NOT NULL AND "releasedTo"='discard' AND "releasedAt" IS NOT NULL AND "funding"='practice'))
);
CREATE UNIQUE INDEX "GamePendingTransfer_sourceId_admissionId_key" ON "GamePendingTransfer"("sourceId","admissionId");
CREATE INDEX "GamePendingTransfer_userId_funding_status_idx" ON "GamePendingTransfer"("userId","funding","status");
CREATE INDEX "GamePendingTransfer_settlementId_status_id_idx" ON "GamePendingTransfer"("settlementId","status","id");
CREATE TABLE "GamePokerRoll" (
  "id" TEXT PRIMARY KEY, "roomId" TEXT NOT NULL, "handId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL, "seatNo" INTEGER NOT NULL, "startSeq" INTEGER NOT NULL,
  "chooseSeq" INTEGER, "data" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "GamePokerRoll_handId_startSeq_idx" ON "GamePokerRoll"("handId","startSeq");
CREATE INDEX "GamePokerRoll_roomId_userId_idx" ON "GamePokerRoll"("roomId","userId");
CREATE OR REPLACE FUNCTION "game_poker_preserve_room_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."variant",NEW."smallBlind",NEW."bigBlind",NEW."ruleOptions",NEW."rollPricingVersion") IS DISTINCT FROM
     (OLD."variant",OLD."smallBlind",OLD."bigBlind",OLD."ruleOptions",OLD."rollPricingVersion") THEN
    RAISE EXCEPTION 'Poker room rules are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION "game_poker_roll_audit_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (OLD."completedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD) OR
       (NEW."id",NEW."roomId",NEW."handId",NEW."userId",NEW."admissionId",NEW."seatNo",NEW."startSeq",NEW."createdAt") IS DISTINCT FROM
       (OLD."id",OLD."roomId",OLD."handId",OLD."userId",OLD."admissionId",OLD."seatNo",OLD."startSeq",OLD."createdAt") THEN
      RAISE EXCEPTION 'Completed Roll records and Roll identity are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('synapse.game.archive_hand',true)=OLD."handId"
    AND EXISTS (SELECT 1 FROM "GamePokerHandArchive" a JOIN "GamePokerHand" h ON h."id"=a."id"
      WHERE a."id"=OLD."handId" AND h."status"='settled'
        AND h."endedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days'
        AND a."data"->'hand'=to_jsonb(h)-'engineState'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(a."data"->'rolls') AS archived_roll(value)
          WHERE archived_roll.value = to_jsonb(OLD))) THEN RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Roll records can only be removed by validated archival';
END;
$$;
CREATE TRIGGER "GamePokerRoll_audit_guard" BEFORE UPDATE OR DELETE ON "GamePokerRoll"
FOR EACH ROW EXECUTE FUNCTION "game_poker_roll_audit_guard"();

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
    'rolls',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."startSeq") FROM "GamePokerRoll" r WHERE r."handId"=p_hand_id),'[]'),
    'seats',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSeat" s WHERE s."handId"=p_hand_id),'[]'),
    'actions',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."seq") FROM "GamePokerAction" a WHERE a."handId"=p_hand_id),'[]'),
    'summaries',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSummary" s WHERE s."handId"=p_hand_id),'[]')
  );
  INSERT INTO "GamePokerActionReceipt"("actionId","userId","roomId","response","createdAt")
    SELECT "actionId","userId","roomId","response","createdAt" FROM "GamePokerAction" WHERE "handId"=p_hand_id
    ON CONFLICT("actionId") DO NOTHING;
  IF EXISTS(SELECT 1 FROM "GamePokerAction" a JOIN "GamePokerActionReceipt" r ON a."actionId"=r."actionId"
    WHERE a."handId"=p_hand_id AND (a."userId"<>r."userId" OR a."roomId"<>r."roomId" OR a."response" IS DISTINCT FROM r."response" OR (a."rollId" IS NOT NULL AND r."requestHash" IS NULL))) THEN
    RAISE EXCEPTION 'Poker receipt does not match archival source';
  END IF;
  INSERT INTO "GamePokerHandArchive"("id","roomId","handNo","participantIds","data","endedAt")
    VALUES(v_hand."id",v_hand."roomId",v_hand."handNo",v_users,v_data,v_hand."endedAt") ON CONFLICT("id") DO NOTHING;
  SELECT "data" INTO v_stored FROM "GamePokerHandArchive" WHERE "id"=p_hand_id;
  IF v_stored IS DISTINCT FROM v_data THEN RAISE EXCEPTION 'Poker archive does not match hot records'; END IF;
  PERFORM set_config('synapse.game.archive_hand',p_hand_id,true);
  DELETE FROM "GamePokerRoll" WHERE "handId"=p_hand_id;
  DELETE FROM "GamePokerAction" WHERE "handId"=p_hand_id;
  DELETE FROM "GamePokerHandSeat" WHERE "handId"=p_hand_id;
  DELETE FROM "GamePokerHandSummary" WHERE "handId"=p_hand_id;
  IF v_current_hand=p_hand_id THEN UPDATE "GamePokerRoom" SET "currentHandId"=NULL WHERE "id"=v_room_id; END IF;
  DELETE FROM "GamePokerHand" WHERE "id"=p_hand_id;
  PERFORM set_config('synapse.game.archive_hand','',true);
  RETURN true;
END;
$$;
