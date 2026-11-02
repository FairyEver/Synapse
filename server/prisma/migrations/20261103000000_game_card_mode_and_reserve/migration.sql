BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Existing rooms retain NULL versions and their original financial semantics.
ALTER TABLE "GamePokerRoom" ADD COLUMN "cardRulesVersion" TEXT, ADD COLUMN "chipRulesVersion" TEXT, ADD COLUMN "actionStartedAt" TIMESTAMP(3);
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
COMMIT;
