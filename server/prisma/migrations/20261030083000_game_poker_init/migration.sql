-- CreateTable
CREATE TABLE "GameAccount" (
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1000000,
    "lastGrantAt" TIMESTAMP(3),
    "netProfit" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameKind" TEXT NOT NULL,
    "gameRoomId" TEXT NOT NULL,
    "roomCode" TEXT,
    "seatNo" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "needsAction" BOOLEAN NOT NULL DEFAULT false,
    "deadlineAt" TIMESTAMP(3),
    "inPlay" INTEGER NOT NULL DEFAULT 0,
    "buyIn" INTEGER NOT NULL DEFAULT 0,
    "returned" INTEGER,
    "lastEventId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerRoom" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "maxSeats" INTEGER NOT NULL,
    "buyIn" INTEGER NOT NULL,
    "smallBlind" INTEGER NOT NULL DEFAULT 1,
    "bigBlind" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "handNo" INTEGER NOT NULL DEFAULT 0,
    "dealerSeat" INTEGER NOT NULL DEFAULT 0,
    "currentHandId" TEXT,
    "actionDeadlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "GamePokerRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerSeat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT,
    "modelName" TEXT,
    "displayName" TEXT NOT NULL,
    "stack" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastNudgedAt" TIMESTAMP(3),
    "joinedHandNo" INTEGER,
    "leavePending" BOOLEAN NOT NULL DEFAULT false,
    "sitPending" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GamePokerSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerHand" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "handNo" INTEGER NOT NULL,
    "dealerSeat" INTEGER NOT NULL,
    "board" JSONB NOT NULL,
    "street" TEXT NOT NULL,
    "pot" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'dealing',
    "actionSeq" INTEGER NOT NULL DEFAULT 0,
    "showdownSeats" JSONB NOT NULL DEFAULT '[]',
    "engineState" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "result" JSONB,

    CONSTRAINT "GamePokerHand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerHandSeat" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "holeCards" JSONB NOT NULL,
    "startingStack" INTEGER NOT NULL,
    "endingStack" INTEGER,
    "folded" BOOLEAN NOT NULL DEFAULT false,
    "allIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GamePokerHandSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerAction" (
    "id" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "street" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "potAfter" INTEGER NOT NULL,
    "isAuto" BOOLEAN NOT NULL DEFAULT false,
    "personaVersionId" TEXT,
    "elapsedMs" INTEGER,
    "note" TEXT,
    "actionId" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePokerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerAgent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "persona" TEXT NOT NULL DEFAULT '',
    "currentVersionId" TEXT,
    "versionSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamePokerAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerAgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "persona" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePokerAgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePokerHandSummary" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "handId" TEXT NOT NULL,
    "handNo" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "holeCards" JSONB NOT NULL,
    "board" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamePokerHandSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameSession_userId_status_idx" ON "GameSession"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_userId_gameKind_gameRoomId_key" ON "GameSession"("userId", "gameKind", "gameRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerRoom_code_key" ON "GamePokerRoom"("code");

-- CreateIndex
CREATE INDEX "GamePokerRoom_status_actionDeadlineAt_idx" ON "GamePokerRoom"("status", "actionDeadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerSeat_roomId_seatNo_key" ON "GamePokerSeat"("roomId", "seatNo");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerSeat_roomId_userId_key" ON "GamePokerSeat"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerHand_roomId_handNo_key" ON "GamePokerHand"("roomId", "handNo");

-- CreateIndex
CREATE INDEX "GamePokerHandSeat_handId_userId_idx" ON "GamePokerHandSeat"("handId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerHandSeat_handId_seatNo_key" ON "GamePokerHandSeat"("handId", "seatNo");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerAction_actionId_key" ON "GamePokerAction"("actionId");

-- CreateIndex
CREATE INDEX "GamePokerAction_roomId_createdAt_idx" ON "GamePokerAction"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "GamePokerAction_roomId_userId_isAuto_createdAt_idx" ON "GamePokerAction"("roomId", "userId", "isAuto", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerAction_handId_seq_key" ON "GamePokerAction"("handId", "seq");

-- CreateIndex
CREATE INDEX "GamePokerAgent_userId_createdAt_idx" ON "GamePokerAgent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GamePokerAgentVersion_agentId_createdAt_idx" ON "GamePokerAgentVersion"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerAgentVersion_agentId_versionNo_key" ON "GamePokerAgentVersion"("agentId", "versionNo");

-- CreateIndex
CREATE INDEX "GamePokerHandSummary_userId_createdAt_idx" ON "GamePokerHandSummary"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GamePokerHandSummary_handId_userId_key" ON "GamePokerHandSummary"("handId", "userId");

-- Financial invariants also hold when a caller bypasses the service.
ALTER TABLE "GameAccount" ADD CONSTRAINT "GameAccount_points_nonnegative" CHECK ("points" >= 0);
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_inPlay_nonnegative" CHECK ("inPlay" >= 0);
ALTER TABLE "GamePokerSeat" ADD CONSTRAINT "GamePokerSeat_stack_nonnegative" CHECK ("stack" >= 0);
ALTER TABLE "GamePokerRoom" ADD CONSTRAINT "GamePokerRoom_rules" CHECK ("maxSeats" BETWEEN 2 AND 10 AND "buyIn" IN (500,1000,2000,5000));
CREATE FUNCTION "game_poker_immutable_record"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Poker actions and persona versions are append-only'; END;
$$;
CREATE TRIGGER "GamePokerAction_immutable" BEFORE UPDATE OR DELETE ON "GamePokerAction" FOR EACH ROW EXECUTE FUNCTION "game_poker_immutable_record"();
CREATE TRIGGER "GamePokerAgentVersion_immutable" BEFORE UPDATE OR DELETE ON "GamePokerAgentVersion" FOR EACH ROW EXECUTE FUNCTION "game_poker_immutable_record"();
