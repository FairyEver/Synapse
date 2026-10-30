import { z } from "zod"

const controlFields = {
  controller: z.enum(["human", "ai"]).nullable(),
  controlVersion: z.number().int().nonnegative(),
  handoffPending: z.boolean(),
}
const control = z.object(controlFields).passthrough()
const rules = z.object({ variant: z.enum(["standard52", "short32"]), smallBlind: z.number(), bigBlind: z.number() }).passthrough()
const checkpoint = z.object({
  roomCode: z.string(), cursor: z.string(), controlVersion: z.number().int().nonnegative(),
  sessionStyle: z.string(), continueIntent: z.boolean(), pauseReason: z.literal("context_maintenance"), savedAt: z.string(),
}).passthrough()
const settlement = z.object({
  handId: z.string(), handNo: z.number(), board: z.array(z.string()), rules,
  seats: z.array(z.object({
    seatNo: z.number(), displayName: z.string(), participantKind: z.enum(["human", "bot"]),
    isMe: z.boolean(), folded: z.boolean(), hole: z.array(z.string()).optional(),
    delta: z.number(), payout: z.number(), endingStack: z.number(), handName: z.string().optional(),
  }).passthrough()),
  pots: z.array(z.object({
    amount: z.number(), eligible: z.array(z.number()), winners: z.array(z.number()),
    shares: z.record(z.string(), z.number()), refund: z.boolean(),
  }).passthrough()),
  mixedControl: z.boolean(),
}).passthrough()
const version = z.object({ versionNo: z.number(), persona: z.string() }).passthrough()
const action = z
  .object({
    actionSource: z.enum(["mcp", "human", "timeout", "rules_bot"]).optional(),
    seq: z.number(),
    seatNo: z.number(),
    displayName: z.string().optional(),
    street: z.string(),
    action: z.string(),
    amount: z.number(),
    potAfter: z.number(),
    isAuto: z.boolean(),
    note: z.string().nullable().optional(),
    personaVersionId: z.string().nullable().optional(),
    personaVersion: version.nullable().optional(),
  })
  .passthrough()
const seat = z
  .object({
    controller: controlFields.controller.optional(),
    controlVersion: controlFields.controlVersion.optional(),
    handoffPending: controlFields.handoffPending.optional(),
    participantKind: z.enum(["human", "bot"]).optional(),
    botId: z.string().optional(),
    leavePending: z.boolean().optional(),
    seatNo: z.number(),
    displayName: z.string(),
    stack: z.number(),
    status: z.string(),
    isMe: z.boolean(),
    streetBet: z.number(),
    aiState: z.string(),
    hole: z.array(z.string()).optional(),
  })
  .passthrough()
const table = z
  .object({
    requiresJoinApproval: z.boolean().optional(),
    variant: z.enum(["standard52", "short32"]).optional(),
    smallBlind: z.number().optional(),
    bigBlind: z.number().optional(),
    actionSeq: z.number().int().nonnegative().optional(),
    controller: controlFields.controller.optional(),
    controlVersion: controlFields.controlVersion.optional(),
    handoffPending: controlFields.handoffPending.optional(),
    pauseReason: z.enum(["user", "context_maintenance"]).nullable().optional(),
    nextHandAt: z.string().nullable().optional(),
    settlement: settlement.nullable().optional(),
    mode: z.enum(["points", "practice"]).optional(),
    roomCode: z.string(),
    name: z.string().nullable(),
    status: z.string(),
    buyIn: z.number(),
    ownerUserId: z.string().optional(),
    maxSeats: z.number(),
    handId: z.string().nullable(),
    handNo: z.number(),
    street: z.string().nullable(),
    board: z.array(z.string()),
    pot: z.number(),
    dealerSeat: z.number(),
    actionOnSeat: z.number().nullable(),
    deadlineMs: z.number().nullable(),
    cursor: z.string(),
    mySeatNo: z.number().nullable(),
    seats: z.array(seat),
    recentActions: z.array(action),
    deckRemaining: z.number(),
    persona: z.string().optional(),
    hole: z.array(z.string()).optional(),
    toCall: z.number().optional(),
    legalActions: z.array(z.string()).optional(),
    minRaiseTo: z.number().optional(),
    maxRaiseTo: z.number().optional(),
  })
  .passthrough()
const agent = z
  .object({
    id: z.string(),
    model: z.string(),
    persona: z.string(),
    currentVersionId: z.string().nullable(),
    versionSeq: z.number(),
  })
  .passthrough()
const stats = z
  .object({
    hands: z.number(),
    netProfit: z.number(),
    vpip: z.number(),
    pfr: z.number(),
    aggression: z.number(),
    winRate: z.number(),
  })
  .passthrough()
const room = z
  .object({
    rules: rules.optional(),
    mode: z.enum(["points", "practice"]).optional(),
    roomCode: z.string(),
    name: z.string().nullable(),
    ownerUserId: z.string(),
    maxSeats: z.number(),
    buyIn: z.number(),
    status: z.string(),
    smallBlind: z.number(),
    bigBlind: z.number(),
    players: z.number(),
  })
  .passthrough()
const summary = z
  .object({
    rules: rules.optional(),
    handId: z.string(),
    mode: z.enum(["points", "practice"]).optional(),
    roomCode: z.string(),
    handNo: z.number(),
    seatNo: z.number(),
    delta: z.number(),
    result: z.string(),
    hole: z.array(z.string()),
    board: z.array(z.string()),
    createdAt: z.string(),
  })
  .passthrough()
const page = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      nextOffset: z.number().nullable(),
    })
    .passthrough()
const wait = z.discriminatedUnion("status", [
  z.object({ status: z.literal("control_released"), cursor: z.string(), controlVersion: controlFields.controlVersion.optional(), handoffPending: controlFields.handoffPending.optional() }).passthrough(),
  z.object({ status: z.literal("waiting"), cursor: z.string() }).passthrough(),
  z
    .object({
      status: z.literal("your_turn"),
      controlVersion: controlFields.controlVersion.optional(),
      actionSeq: z.number().int().nonnegative().optional(),
      handId: z.string(),
      handNo: z.number(),
      street: z.string(),
      board: z.array(z.string()),
      hole: z.array(z.string()),
      pot: z.number(),
      toCall: z.number(),
      minRaiseTo: z.number(),
      maxRaiseTo: z.number(),
      streetBets: z.record(z.string(), z.number()),
      seats: z.array(seat),
      recentActions: z.array(action),
      persona: z.string(),
      legalActions: z.array(z.string()),
      deadlineMs: z.number().nullable(),
      cursor: z.string(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("hand_result"),
      handNo: z.number(),
      result: z.string(),
      delta: z.number(),
      stack: z.number(),
      cursor: z.string(),
    })
    .passthrough(),
  z
    .object({
      status: z.literal("table_closed"),
      cursor: z.string(),
      lastAutoAction: z
        .object({ handNo: z.number(), action: z.string(), reason: z.string() })
        .passthrough()
        .optional(),
    })
    .passthrough(),
])

const tableEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action"), handId: z.string(), handNo: z.number(), seq: z.number(), action }).passthrough(),
  z.object({ kind: z.literal("settlement"), handId: z.string(), handNo: z.number(), seq: z.literal(2147483647), settlement }).passthrough(),
])
export const POKER_RESPONSE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "app.game.poker.control.claim": control,
  "app.game.poker.control.set": control,
  "app.game.poker.checkpoint.get": z.object({ checkpoint: checkpoint.nullable() }).passthrough(),
  "app.game.poker.checkpoint.save": z.object({ checkpoint }).passthrough(),
  "app.game.poker.table.events": z.object({ events: z.array(tableEvent), cursor: z.string(), hasMore: z.boolean() }).passthrough(),
  "app.game.poker.guide": z
    .object({
      rules: z.record(z.string(), z.unknown()),
      loop: z.string(),
      persona: z.string(),
      errors: z.record(z.string(), z.string()),
      tools: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            mutates: z.boolean(),
            inputSchema: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
  "app.game.poker.lobby.list": page(room),
  "app.game.poker.bot.add": z.object({ botId: z.string(), seatNo: z.number() }).passthrough(),
  "app.game.poker.bot.remove": z.object({ pending: z.boolean() }).passthrough(),
  "app.game.poker.room.create": z.object({ roomCode: z.string() }).passthrough(),
  "app.game.poker.room.get": table,
  "app.game.poker.seat.join": z.object({ roomCode: z.string(), seatNo: z.number() }).passthrough(),
  "app.game.poker.seat.leave": z.object({ pending: z.boolean() }).passthrough(),
  "app.game.poker.seat.sit": z
    .object({ sittingOut: z.boolean(), pending: z.boolean(), status: z.string() })
    .passthrough(),
  "app.game.poker.seat.nudge": z.object({ notificationId: z.string() }).passthrough(),
  "app.game.poker.table.wait": wait,
  "app.game.poker.table.state": table,
  "app.game.poker.action.act": z
    .object({ ok: z.literal(true), handId: z.string(), actionSeq: z.number(), cursor: z.string() })
    .passthrough(),
  "app.game.poker.agent.list": z.array(agent),
  "app.game.poker.agent.upsert": agent,
  "app.game.poker.agent.versions": z.array(
    z
      .object({
        id: z.string(),
        versionNo: z.number(),
        persona: z.string(),
        createdAt: z.string(),
        firstUsedAt: z.string().nullable(),
        handCount: z.number(),
      })
      .passthrough(),
  ),
  "app.game.poker.hand.history": page(summary),
  "app.game.poker.hand.detail": z
    .object({
      rules: rules.optional(),
      handId: z.string(),
      handNo: z.number(),
      mode: z.enum(["points", "practice"]).optional(),
    roomCode: z.string(),
      board: z.array(z.string()),
      street: z.string(),
      result: z.unknown(),
      seats: z.array(
        z
          .object({
            seatNo: z.number(),
            displayName: z.string(),
            participantKind: z.enum(["human", "bot"]).optional(),
            startingStack: z.number(),
            endingStack: z.number().nullable(),
            folded: z.boolean(),
            hole: z.array(z.string()).optional(),
          })
          .passthrough(),
      ),
      actions: z.array(action),
    })
    .passthrough(),
  "app.game.poker.stats.get": stats.extend({
    comparison: z
      .array(stats.extend({ seatNo: z.number(), displayName: z.string(), isMe: z.boolean() }))
      .optional(),
  }),
  "app.game.poker.room.close": z.union([
    z.object({ pending: z.boolean() }).passthrough(),
    z.object({ closed: z.boolean() }).passthrough(),
  ]),
}
