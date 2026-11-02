BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Existing rooms retain NULL versions and their original financial semantics.
ALTER TABLE "GamePokerRoom" ADD COLUMN "cardRulesVersion" TEXT, ADD COLUMN "chipRulesVersion" TEXT, ADD COLUMN "actionStartedAt" TIMESTAMP(3);
ALTER TABLE "GamePokerAction" ADD COLUMN "nominalAmount" INTEGER, ADD COLUMN "waivedAmount" INTEGER,
  ADD CONSTRAINT "GamePokerAction_payment_check" CHECK (
    ("nominalAmount" IS NULL AND "waivedAmount" IS NULL) OR
    ("nominalAmount" IS NOT NULL AND "waivedAmount" IS NOT NULL AND "waivedAmount">=0 AND "nominalAmount"="amount"+"waivedAmount")
  );
CREATE TABLE "GameReserveLot" (
  "id" TEXT PRIMARY KEY, "gameKind" TEXT NOT NULL, "gameRoomId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL, "funding" TEXT NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
  "sourceId" TEXT NOT NULL, "sourceType" TEXT NOT NULL, "sourceSeq" INTEGER NOT NULL,
  "payerAdmissionId" TEXT NOT NULL, "payerUserId" TEXT NOT NULL, "payerSeatNo" INTEGER NOT NULL,
  "originalAmount" INTEGER NOT NULL, "remainingAmount" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameReserveLot_amount_check" CHECK ("originalAmount" > 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "originalAmount"),
  CONSTRAINT "GameReserveLot_scope_check" CHECK ("funding" IN ('points','practice') AND "revision" >= 0 AND "sourceSeq" >= 0),
  CONSTRAINT "GameReserveLot_status_check" CHECK ("status"='pending' OR ("status"='finalized' AND "remainingAmount"=0))
);
CREATE UNIQUE INDEX "GameReserveLot_settlementId_sourceId_key" ON "GameReserveLot"("settlementId", "sourceId");
CREATE INDEX "GameReserveLot_settlementId_id_idx" ON "GameReserveLot"("settlementId", "id");
CREATE TABLE "GameReserveClaim" (
  "id" TEXT PRIMARY KEY, "lotId" TEXT NOT NULL REFERENCES "GameReserveLot"("id") ON DELETE RESTRICT,
  "gameKind" TEXT NOT NULL, "gameRoomId" TEXT NOT NULL, "settlementId" TEXT NOT NULL, "funding" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "seatNo" INTEGER NOT NULL,
  "originalAmount" INTEGER NOT NULL, "remainingAmount" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  CONSTRAINT "GameReserveClaim_amount_check" CHECK ("originalAmount" >= 0 AND "remainingAmount" >= 0 AND "remainingAmount" <= "originalAmount"),
  CONSTRAINT "GameReserveClaim_scope_check" CHECK ("funding" IN ('points','practice')),
  CONSTRAINT "GameReserveClaim_status_check" CHECK ("status"='pending' OR ("status"='finalized' AND "remainingAmount"=0))
);
CREATE UNIQUE INDEX "GameReserveClaim_lotId_admissionId_key" ON "GameReserveClaim"("lotId", "admissionId");
CREATE INDEX "GameReserveClaim_userId_funding_status_idx" ON "GameReserveClaim"("userId", "funding", "status");
CREATE INDEX "GameReserveClaim_settlementId_id_idx" ON "GameReserveClaim"("settlementId", "id");
CREATE TABLE "GameReserveMovement" (
  "id" TEXT PRIMARY KEY, "lotId" TEXT NOT NULL REFERENCES "GameReserveLot"("id") ON DELETE RESTRICT,
  "claimId" TEXT REFERENCES "GameReserveClaim"("id") ON DELETE RESTRICT,
  "gameKind" TEXT NOT NULL, "gameRoomId" TEXT NOT NULL, "settlementId" TEXT NOT NULL, "funding" TEXT NOT NULL,
  "rootActionId" TEXT NOT NULL, "eventIndex" INTEGER NOT NULL, "kind" TEXT NOT NULL, "amount" INTEGER NOT NULL,
  "toAdmissionId" TEXT, "actorAdmissionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameReserveMovement_amount_check" CHECK ("amount">0 AND "eventIndex">=0),
  CONSTRAINT "GameReserveMovement_scope_check" CHECK ("funding" IN ('points','practice')),
  CONSTRAINT "GameReserveMovement_kind_check" CHECK ("kind" IN ('deposit','steal','refund','finalize'))
);
CREATE UNIQUE INDEX "GameReserveMovement_settlementId_rootActionId_eventIndex_key" ON "GameReserveMovement"("settlementId", "rootActionId", "eventIndex");
CREATE INDEX "GameReserveMovement_settlementId_id_idx" ON "GameReserveMovement"("settlementId", "id");
CREATE TABLE "GamePokerResolution" (
  "id" TEXT PRIMARY KEY, "roomId" TEXT NOT NULL, "handId" TEXT NOT NULL REFERENCES "GamePokerHand"("id") ON DELETE RESTRICT,
  "seq" INTEGER NOT NULL, "actionId" TEXT NOT NULL, "actorAdmissionId" TEXT, "actorUserId" TEXT,
  "source" TEXT NOT NULL, "version" TEXT NOT NULL, "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GamePokerResolution_seq_check" CHECK ("seq">=0)
);
CREATE UNIQUE INDEX "GamePokerResolution_handId_seq_key" ON "GamePokerResolution"("handId", "seq");
CREATE UNIQUE INDEX "GamePokerResolution_actionId_key" ON "GamePokerResolution"("actionId");
CREATE INDEX "GamePokerResolution_roomId_handId_seq_idx" ON "GamePokerResolution"("roomId", "handId", "seq");
CREATE FUNCTION "game_reserve_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='GamePokerResolution' AND TG_OP='DELETE'
    AND current_setting('synapse.game.archive_hand',true)=OLD."handId"
    AND EXISTS (SELECT 1 FROM "GamePokerHandArchive" a JOIN "GamePokerHand" h ON h."id"=a."id"
      WHERE a."id"=OLD."handId" AND h."status"='settled'
        AND h."endedAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days'
        AND a."data"->'hand'=to_jsonb(h)-'engineState'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(a."data"->'resolutions') AS fact(value)
          WHERE fact.value=to_jsonb(OLD))) THEN RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Game financial movements and resolution facts are append-only';
END;
$$;
CREATE TRIGGER "GameReserveMovement_append_only" BEFORE UPDATE OR DELETE ON "GameReserveMovement" FOR EACH ROW EXECUTE FUNCTION "game_reserve_append_only"();
CREATE TRIGGER "GamePokerResolution_append_only" BEFORE UPDATE OR DELETE ON "GamePokerResolution" FOR EACH ROW EXECUTE FUNCTION "game_reserve_append_only"();
CREATE OR REPLACE FUNCTION "game_poker_preserve_room_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."variant",NEW."smallBlind",NEW."bigBlind",NEW."ruleOptions",NEW."rollPricingVersion",NEW."cardRulesVersion",NEW."chipRulesVersion") IS DISTINCT FROM
     (OLD."variant",OLD."smallBlind",OLD."bigBlind",OLD."ruleOptions",OLD."rollPricingVersion",OLD."cardRulesVersion",OLD."chipRulesVersion") THEN
    RAISE EXCEPTION 'Poker room rules are immutable';
  END IF;
  RETURN NEW;
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
  SELECT * INTO v_hand FROM "GamePokerHand" WHERE "id"=p_hand_id AND "status"='settled'
    AND "endedAt" <= LEAST(p_cutoff,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '90 days') FOR UPDATE;
  IF NOT FOUND OR (v_room_status='running' AND v_current_hand=p_hand_id) THEN RETURN false; END IF;
  SELECT array_agg(DISTINCT "userId" ORDER BY "userId") INTO v_users FROM "GamePokerHandSeat" WHERE "handId"=p_hand_id;
  v_data := jsonb_build_object(
    'hand',to_jsonb(v_hand)-'engineState',
    'cards',v_hand."engineState"->'cards',
    'reserve',v_hand."engineState"->'reserve',
    'resolutions',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."seq") FROM "GamePokerResolution" r WHERE r."handId"=p_hand_id),'[]'),
    'rolls',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."startSeq") FROM "GamePokerRoll" r WHERE r."handId"=p_hand_id),'[]'),
    'seats',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSeat" s WHERE s."handId"=p_hand_id),'[]'),
    'actions',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a."seq") FROM "GamePokerAction" a WHERE a."handId"=p_hand_id),'[]'),
    'summaries',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s."seatNo") FROM "GamePokerHandSummary" s WHERE s."handId"=p_hand_id),'[]')
  );
  INSERT INTO "GamePokerActionReceipt"("actionId","userId","roomId","response","createdAt")
    SELECT "actionId","userId","roomId","response","createdAt" FROM "GamePokerAction" WHERE "handId"=p_hand_id
    ON CONFLICT("actionId") DO NOTHING;
  IF EXISTS(SELECT 1 FROM "GamePokerAction" a JOIN "GamePokerActionReceipt" r ON a."actionId"=r."actionId"
    WHERE a."handId"=p_hand_id AND (a."userId"<>r."userId" OR a."roomId"<>r."roomId" OR a."response" IS DISTINCT FROM r."response" OR ((a."rollId" IS NOT NULL OR a."action" IN ('card_play','card_choose')) AND r."requestHash" IS NULL))) THEN
    RAISE EXCEPTION 'Poker receipt does not match archival source';
  END IF;
  INSERT INTO "GamePokerHandArchive"("id","roomId","handNo","participantIds","data","endedAt")
    VALUES(v_hand."id",v_hand."roomId",v_hand."handNo",v_users,v_data,v_hand."endedAt") ON CONFLICT("id") DO NOTHING;
  SELECT "data" INTO v_stored FROM "GamePokerHandArchive" WHERE "id"=p_hand_id;
  IF v_stored IS DISTINCT FROM v_data THEN RAISE EXCEPTION 'Poker archive does not match hot records'; END IF;
  PERFORM set_config('synapse.game.archive_hand',p_hand_id,true);
  DELETE FROM "GamePokerResolution" WHERE "handId"=p_hand_id;
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

COMMIT;
