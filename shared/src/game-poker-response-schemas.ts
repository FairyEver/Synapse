import { pokerCardResultSchema, pokerCardViewSchema, pokerReserveViewSchema, pokerResolutionFrameSchema, pokerPaymentSchema } from "./game-poker-card-schemas.js"
import { z } from "zod"
import { POKER_MAX_ROLL_COINS } from "./game.js"

const controlFields = {
  controller: z.enum(["human", "ai"]).nullable(),
  controlVersion: z.number().int().nonnegative(),
  handoffPending: z.boolean(),
}
const control = z.object(controlFields).passthrough()
const ruleOptions = z.object({ cards: z.boolean().optional(), roll: z.boolean().optional(), rollCoins: z.number().int().min(1).max(POKER_MAX_ROLL_COINS).optional() }).strict()
const rollCoins = z.object({ balance: z.number().int().nonnegative(), limit: z.number().int().positive() }).strict().refine(coins => coins.balance <= coins.limit)
const rollOffer = z.object({ payment: pokerPaymentSchema.optional(), coinCost: z.number().int().positive().optional(), fee: z.number().int().nonnegative(), available: z.boolean(), reason: z.string().optional() }).strict()
const rollPending = z.object({ rollId: z.string(), cardIndex: z.number().int().min(0).max(1), candidates: z.array(z.string()).length(3) }).strict()
const roll = z.object({ coins: rollCoins.optional(), enabled: z.boolean(), pricingVersion: z.string().optional(), count: z.number().int().nonnegative().optional(), normal: rollOffer.optional(), super: rollOffer.optional(), pending: rollPending.nullable().optional(), pendingSeatNo: z.number().int().nonnegative().nullable().optional() }).strict()
const rollPublic = z.object({ kind: z.enum(["normal", "super"]), phase: z.enum(["start", "choose"]), fee: z.number().int().positive(), count: z.number().int().positive(), seatNo: z.number(), displayName: z.string(), source: z.enum(["human", "mcp", "rules_bot", "timeout"]), compensations: z.record(z.string(), z.number().int().nonnegative()) }).strict()
const rollAmounts = { count: z.number().int().nonnegative(), paid: z.number().int().nonnegative() }
const rollTotals = z.object({ ...rollAmounts, players: z.number().int().nonnegative() }).strict()
const rollStats = z.object({
  hand: rollTotals, room: rollTotals,
  seats: z.array(z.object({ seatNo: z.number().int().min(0).max(9), key: z.string(), hand: z.object(rollAmounts).strict(), room: z.object(rollAmounts).strict() }).strict()).max(10),
}).strict()
const rollPrivate = z.object({ rollId: z.string(), kind: z.enum(["normal", "super"]), cardIndex: z.number().int().min(0).max(1), oldCard: z.string(), candidates: z.array(z.string()).min(1).max(3), selectedIndex: z.number().int().min(0).max(2).nullable(), fee: z.number().int().positive(), street: z.enum(["preflop", "flop", "turn"]), count: z.number().int().positive() }).strict()
const ledgerKey = z.string().min(1)
const ledgerAmount = z.number().int().nonnegative()
const rollLedger = z.object({
  handId: ledgerKey,
  status: z.enum(["pending", "released", "cancelled"]),
  players: z.array(z.object({ key: ledgerKey, seatNo: z.number().int().min(0).max(9), displayName: z.string(), isMe: z.boolean(), folded: z.boolean() }).strict()).max(10),
  entries: z.array(z.object({
    id: ledgerKey, payerKey: ledgerKey, kind: z.enum(["normal", "super"]), street: z.enum(["preflop", "flop", "turn"]), fee: ledgerAmount.positive(),
    compensations: z.array(z.object({ key: ledgerKey, amount: ledgerAmount }).strict()).max(9),
  }).strict()),
}).strict().superRefine((ledger, ctx) => {
  const keys = new Set(ledger.players.map(player => player.key))
  const seats = new Set(ledger.players.map(player => player.seatNo))
  if (keys.size !== ledger.players.length || seats.size !== ledger.players.length || ledger.players.filter(player => player.isMe).length > 1)
    ctx.addIssue({ code: "custom", message: "账本玩家身份重复。" })
  const ids = new Set<string>()
  for (const entry of ledger.entries) {
    if (ids.has(entry.id) || !keys.has(entry.payerKey)) ctx.addIssue({ code: "custom", message: "账本付款记录无效。" })
    ids.add(entry.id)
    const recipients = new Set<string>()
    for (const recipient of entry.compensations) {
      if (!keys.has(recipient.key) || recipient.key === entry.payerKey || recipients.has(recipient.key))
        ctx.addIssue({ code: "custom", message: "账本收款身份无效。" })
      recipients.add(recipient.key)
    }
    const sum = entry.compensations.reduce((total, recipient) => total + BigInt(recipient.amount), 0n)
    if (sum !== BigInt(entry.fee)) ctx.addIssue({ code: "custom", message: "账本费用分配不守恒。" })
  }
})
const rollResult = z.object({ ok: z.literal(true), handId: z.string(), rollId: z.string(), actionSeq: z.number().int().nonnegative(), cursor: z.string(), status: z.enum(["completed", "choice_required"]) }).passthrough()
const rules = z.object({ cardRulesVersion: z.literal("cards-v1").optional(), chipRulesVersion: z.literal("chips-v2").optional(), ruleOptions: ruleOptions.optional(), rollPricingVersion: z.string().optional(), variant: z.enum(["standard52", "short32"]), smallBlind: z.number(), bigBlind: z.number() }).passthrough()
const checkpoint = z.object({
  roomCode: z.string(), cursor: z.string(), controlVersion: z.number().int().nonnegative(),
  sessionStyle: z.string(), continueIntent: z.boolean(), pauseReason: z.literal("context_maintenance"), savedAt: z.string(),
}).passthrough()
const settlement = z.object({
  handId: z.string(), handNo: z.number(), board: z.array(z.string()), rules,
  seats: z.array(z.object({
    seatNo: z.number(), displayName: z.string(), participantKind: z.enum(["human", "bot"]),
    isMe: z.boolean(), folded: z.boolean(), hole: z.array(z.string()).optional(),
    rollPaid: z.number().optional(), rollReceived: z.number().optional(), pokerDelta: z.number().optional(),
    reservePaid: z.number().int().nonnegative().optional(), reserveReceived: z.number().int().nonnegative().optional(), reserveStolen: z.number().int().nonnegative().optional(), reserveRefunded: z.number().int().nonnegative().optional(),
    delta: z.number(), payout: z.number(), endingStack: z.number(), handName: z.string().optional(), bestFive: z.array(z.string()).length(5).optional(),
  }).passthrough()),
  pots: z.array(z.object({
    amount: z.number(), eligible: z.array(z.number()), winners: z.array(z.number()),
    shares: z.record(z.string(), z.number()), refund: z.boolean(), reason: z.string().optional(),
  }).passthrough()),
  mixedControl: z.boolean(),
}).passthrough()
const version = z.object({ versionNo: z.number(), persona: z.string() }).passthrough()
const action = z
  .object({
    nominalAmount: z.number().int().nonnegative().optional(), waivedAmount: z.number().int().nonnegative().optional(),
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
    publicHole: z.array(z.object({ index: z.number().int().min(0).max(1), card: z.string().regex(/^[2-9TJQKA][shdc]$/) }).strict()).max(2).optional(),
    rollCount: z.number().int().nonnegative().optional(),
    rollPaid: z.number().int().nonnegative().optional(),
    pendingCompensation: z.number().int().nonnegative().optional(),
    nextHandEligible: z.boolean().optional(),
    readyForNextHand: z.boolean().optional(),
    isHistorical: z.boolean().optional(),
    inCurrentHand: z.boolean().optional(),
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
const chipCount = z.object({value:z.union([z.literal(1),z.literal(5),z.literal(10),z.literal(25),z.literal(100),z.literal(200),z.literal(500)]),count:z.number().int().positive()}).strict()
const chipState = z.object({pot:z.array(chipCount).max(7),roll:z.array(chipCount).max(7),reserve:z.array(chipCount).max(7).optional(),recent:z.array(z.object({id:z.string(),seq:z.number().int().nonnegative(),seatNo:z.number().int().nonnegative(),amount:z.number().int().nonnegative(),fund:z.enum(["pot","roll","reserve"]),direction:z.enum(["in","out"]).optional(),kind:z.enum(["bet","roll","card","steal","refund","compensation"]).optional()}).strict()).max(4096)}).strict()
const potAmount = z.number().int().nonnegative()
const potContributions = z.object({
  handId: z.string().min(1), status: z.enum(["pending", "settled", "cancelled"]), total: potAmount,
  players: z.array(z.object({
    key: z.string().min(1), seatNo: z.number().int().min(0).max(9), displayName: z.string(), isMe: z.boolean(), folded: z.boolean(), amount: potAmount,
  }).strict()).max(10),
}).strict().superRefine((pot, ctx) => {
  if (new Set(pot.players.map(player => player.key)).size !== pot.players.length ||
      new Set(pot.players.map(player => player.seatNo)).size !== pot.players.length || pot.players.filter(player => player.isMe).length > 1)
    ctx.addIssue({ code: "custom", message: "底池来源玩家身份重复。" })
  // Refinements can run after number validation failed; never convert invalid numbers to BigInt.
  if (!Number.isSafeInteger(pot.total) || pot.players.some(player => !Number.isSafeInteger(player.amount))) return
  if (pot.players.reduce((sum, player) => sum + BigInt(player.amount), 0n) !== BigInt(pot.total))
    ctx.addIssue({ code: "custom", message: "底池来源金额不守恒。" })
})
const handLog = z.object({
  handId: z.string().min(1), complete: z.boolean(),
  entries: z.array(z.object({
    seq: z.number().int().min(-1), seatNo: z.number().int().min(0).max(9), displayName: z.string(),
    street: z.enum(["preflop", "flop", "turn", "river"]),
    action: z.enum(["small_blind", "big_blind", "fold", "check", "call", "bet", "raise", "allin", "roll", "card"]),
    amount: z.number().int().nonnegative(), nominalAmount: z.number().int().nonnegative().optional(), waivedAmount: z.number().int().nonnegative().optional(), isAuto: z.boolean(),
    actionSource: z.enum(["mcp", "human", "timeout", "rules_bot"]).optional(),
    card: z.object({ id: z.string(), name: z.string(), status: z.enum(["completed", "blocked", "choice_required"]) }).strict().optional(),
    roll: z.object({ kind: z.enum(["normal", "super"]), count: z.number().int().positive(), status: z.enum(["pending", "completed", "replaced", "cancelled"]) }).strict().optional(),
  }).strict()).max(1002),
}).strict().superRefine((log, ctx) => {
  if (log.entries.some((entry, index) => (index > 0 && entry.seq <= log.entries[index - 1].seq) || (entry.action === "roll") !== !!entry.roll || (entry.action === "card") !== !!entry.card))
    ctx.addIssue({ code: "custom", message: "本手日志顺序或Roll记录无效。" })
})
const table = z
  .object({
    cards: pokerCardViewSchema.optional(), reserve: pokerReserveViewSchema.optional(), paymentVersion: z.string().optional(), betWaiverCap: z.number().int().nonnegative().optional(),
    handLog: handLog.optional(),
    potContributions: potContributions.optional(),
    chipState: chipState.optional(),
    rollStats: rollStats.optional(),
    rollLedger: rollLedger.optional(),
    rules: rules.optional(), ruleOptions: ruleOptions.optional(), rollPricingVersion: z.string().optional(), roll: roll.optional(),
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
    isRoomOwner: z.boolean().optional(),
    canStart: z.boolean().optional(),
    awaitingReady: z.boolean().optional(),
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
  .passthrough().superRefine((table, ctx) => {
    if (table.handLog && table.handLog.handId !== table.handId)
      ctx.addIssue({ code: "custom", message: "日志不属于当前手牌。" })
    if (table.potContributions && table.potContributions.handId !== table.handId)
      ctx.addIssue({ code: "custom", message: "底池来源不属于当前手牌。" })
  })
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
    myControl: z.object({ ...controlFields, seatNo: z.number().int().nonnegative().nullable() }).optional(),
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
  z.object({ status: z.literal("roll_choice_required"), roll: roll.optional(), handId: z.string(), handNo: z.number(), rollId: z.string(), cardIndex: z.number().int().min(0).max(1), candidates: z.array(z.string()).length(3), controlVersion: controlFields.controlVersion, actionSeq: z.number().int().nonnegative(), deadlineMs: z.number().nullable(), cursor: z.string() }).passthrough(),
  z.object({ status: z.literal("ready_required"), handId: z.string().nullable(), handNo: z.number(), controlVersion: controlFields.controlVersion, cursor: z.string() }).passthrough(),
  z.object({ status: z.literal("control_released"), cursor: z.string(), controlVersion: controlFields.controlVersion.optional(), handoffPending: controlFields.handoffPending.optional() }).passthrough(),
  z.object({ status: z.literal("waiting"), cursor: z.string() }).passthrough(),
  z
    .object({
      status: z.literal("your_turn"),
      rules: rules.optional(), roll: roll.optional(),
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
  z.object({ kind: z.literal("roll"), handId: z.string(), handNo: z.number(), seq: z.number(), roll: rollPublic }).passthrough(),
  z.object({ kind: z.literal("action"), handId: z.string(), handNo: z.number(), seq: z.number(), action }).passthrough(),
  z.object({ kind: z.literal("settlement"), handId: z.string(), handNo: z.number(), seq: z.literal(2147483647), settlement }).passthrough(),
])
export const POKER_RESPONSE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "app.game.poker.card.play": pokerCardResultSchema,
  "app.game.poker.card.choose": pokerCardResultSchema,
  "app.game.poker.roll.start": rollResult,
  "app.game.poker.roll.choose": rollResult,
  "app.game.poker.control.claim": control,
  "app.game.poker.control.set": control,
  "app.game.poker.checkpoint.get": z.object({ checkpoint: checkpoint.nullable() }).passthrough(),
  "app.game.poker.checkpoint.save": z.object({ checkpoint }).passthrough(),
  "app.game.poker.table.events": z.object({ frames: z.array(pokerResolutionFrameSchema).optional(), events: z.array(tableEvent), cursor: z.string(), hasMore: z.boolean() }).passthrough(),
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
  "app.game.poker.room.start": z.object({ handId: z.string(), started: z.boolean() }).passthrough(),
  "app.game.poker.seat.ready": z.object({ handId: z.string().nullable(), started: z.boolean() }).passthrough(),
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
      cards: pokerCardViewSchema.optional(), reserve: pokerReserveViewSchema.optional(), frames: z.array(pokerResolutionFrameSchema).optional(),
      rollHistory: z.array(rollPublic).optional(), privateRolls: z.array(rollPrivate).optional(),
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
