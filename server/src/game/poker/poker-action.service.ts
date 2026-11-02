import { Injectable } from "@nestjs/common"
import { createHash, randomInt, randomUUID } from "node:crypto"
import { PokerRollService, rollActionId } from "./poker-roll.service"
import { botRollObservation, chooseBotRoll, chooseBotRollCandidate } from "./bot-roll-policy"
import { projectRollView } from "./poker-roll-projection"
import { projectRollStats } from "./poker-roll-stats"
import { projectRollLedger } from "./poker-roll-ledger"
import { projectHandLog } from "./poker-hand-log"
import { projectPotContributions } from "./poker-pot-contributions"
import { projectChipState } from "./poker-chip-projection"
import { chooseBotAction } from "./bot-policy"
import type { ActionKind } from "./engine/betting"
import { act, legalActions, removeFromHand } from "./engine/hand-runner"
import { PokerService, sampleRoomTime, json, type RoomContext } from "./poker.service"
import { engine, saveHand, startNext, ACTION_WINDOW_MS } from "./poker-lifecycle"
import { reject } from "./poker-error"
import { assertController, type PokerCaller } from "./poker-control"
import { resolveRules } from "./engine/rules"
import { canSeeHole, projectSettlement, type PokerViewPolicy } from "./poker-projection"
import { nextHandEligible, preparedForNextHand } from "./poker-ready"
import { currentHand } from "./poker-current-hand"
import { assertPokerModeAccess, isCardRoom } from "./poker-mode-policy"
import { resolveHandCommand } from "./engine/resolve-hand"
import { createCardRegistry } from "./engine/cards/catalog-v1"
import { persistHandResolution, reserveScope, roomResolutionContext } from "./poker-resolution"
import { fundedBetCapacity, legalFundedActions, betPaymentVersion } from "./engine/chips/funded-betting"
import { CardRuleError, type HandResolution } from "./engine/cards/types"
import { projectCardView } from "./poker-card-projection"
import { projectReserveView } from "./poker-reserve-projection"
export interface ActionInput {
  expectedPaymentVersion?: string
  handId: string
  street: string
  actionId: string
  action: ActionKind
  to?: number
  note?: string
  personaSource?: "game" | "session"
  controlVersion?: number
  expectedActionSeq?: number
}
@Injectable()
export class PokerActionService {
  constructor(readonly poker: PokerService, readonly rolls: PokerRollService = new PokerRollService(poker)) {}
  async act(userId: string, code: string, input: ActionInput, now: Date | undefined = undefined, caller: PokerCaller = "mcp") {
    return this.poker.withRoom(code, (c) => this.submit(c, userId, input, caller), now)
  }
  private async submit(c: RoomContext, userId: string, input: ActionInput, source: "mcp" | "rules_bot" | "human") {
    assertPokerModeAccess(c.room, source, "act")
    let now = c.now
    const funded = c.room.chipRulesVersion === "chips-v2"
    const requestHash = funded ? createHash("sha256").update(JSON.stringify(["act", userId, c.room.code, input.handId, input.street, input.expectedActionSeq, input.controlVersion, input.action, input.to, input.expectedPaymentVersion, input.personaSource, input.note])).digest("hex") : undefined
    const previous = await c.tx.gamePokerActionReceipt.findUnique({
      where: { actionId: input.actionId },
    })
    if (funded && previous) {
      if (previous.userId !== userId || previous.roomId !== c.room.id || previous.requestHash !== requestHash) reject("POKER_ILLEGAL_ACTION", "actionId已用于不同请求。")
      return previous.response
    }
    if (previous?.requestHash) reject("POKER_ILLEGAL_ACTION", "actionId已用于换牌请求。")
    if (previous && previous.userId === userId && previous.roomId === c.room.id)
      return previous.response
    const seat = c.seats.find((s) => s.userId === userId)
    if (!seat || (source === "rules_bot" ? seat.participantKind !== "bot" || c.room.mode !== "practice" : seat.participantKind === "bot")) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
    if (source !== "rules_bot") assertController(seat, source, input.controlVersion)
    if (c.room.status !== "running") reject("POKER_ROOM_CLOSED", "房间尚未开始或已暂停。")
    const hand = c.room.currentHandId
      ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } })
      : null
    if (!hand || hand.status === "settled")
      reject("POKER_HAND_NOT_ACTIVE", "当前没有进行中的手牌。")
    const h = engine(hand)
    if (h.cards?.pending) reject("POKER_CARD_CHOICE_REQUIRED", "请先完成候选牌选择。")
    if (h.roll?.pending) reject("POKER_ROLL_CHOICE_REQUIRED", "请先完成候选牌选择。")
    const legal = funded ? legalFundedActions(h, seat.seatNo, fundedBetCapacity(h, seat.seatNo)) : legalActions(h, seat.seatNo)
    if (source !== "rules_bot" && input.expectedActionSeq !== hand.actionSeq &&
        !(source === "mcp" && input.expectedActionSeq === undefined && (seat.controlVersion ?? 0) === 0))
      reject("POKER_STALE_ACTION", "行动序号已变更，请重新读取牌桌。")
    if (funded) { await this.poker.lockFunds(c); now = sampleRoomTime(c) }
    const details = {
      legalActions: legal.actions,
      toCall: legal.toCall,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
      deadlineMs: Math.max(0, (c.room.actionDeadlineAt?.getTime() ?? 0) - now.getTime()),
      handId: hand.id,
      street: hand.street,
    }
    if (
      input.handId !== hand.id ||
      input.street !== hand.street ||
      !c.room.actionDeadlineAt ||
      now >= c.room.actionDeadlineAt
    )
      reject("POKER_STALE_ACTION", "行动已过期，请重新wait。", details)
    if (h.actionOnSeat !== seat.seatNo)
      reject(
        seat.status === "sitting_out"
          ? "POKER_SEAT_SITTING_OUT"
          : h.seats.find((s) => s.seatNo === seat.seatNo)?.lastActedBet !== null
            ? "POKER_STALE_ACTION"
            : "POKER_NOT_YOUR_TURN",
        "行动点已变更，请重新wait。",
        details,
      )
    if (seat.status !== "active")
      reject(
        seat.status === "sitting_out" ? "POKER_SEAT_SITTING_OUT" : "POKER_NOT_YOUR_TURN",
        "座位当前不能行动。",
        details,
      )
    if (previous) reject("POKER_ILLEGAL_ACTION", "actionId已被使用。", details)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actionId) ||
      (input.note?.length ?? 0) > 200 ||
      input.note?.includes("\n") ||
      input.note?.includes("\r")
    )
      reject("POKER_ILLEGAL_ACTION", "actionId须为UUID，note限200字单行。", details)
    const context = roomResolutionContext(c, hand.id, hand.actionSeq + 1, input.actionId, seat, source)
    let next, resolution: HandResolution | undefined
    try {
      if (funded) { resolution = resolveHandCommand(h, { kind: "bet", seatNo: seat.seatNo, decision: input, controlVersion: seat.controlVersion, expectedPaymentVersion: input.expectedPaymentVersion, scope: reserveScope(c, hand.id) }, context, createCardRegistry()); next = resolution.state }
      else next = act(h, seat.seatNo, input)
    } catch (error) {
      if (error instanceof CardRuleError) reject(error.code, "当前支付或行动报价已失效。", details)
      reject("POKER_ILLEGAL_ACTION", "动作或数额不合法。", details)
    }
    const agent = source !== "human" && seat.agentId
      ? await c.tx.gamePokerAgent.findFirst({
          where: { id: seat.agentId, userId },
          select: { currentVersionId: true },
        })
      : null
    const seq = hand.actionSeq + 1
    const result = {
      ok: true,
      handId: hand.id,
      actionSeq: seq,
      cursor: `${hand.handNo}:${seq}`,
    }
    const before = h.seats.find((s) => s.seatNo === seat.seatNo)!,
      after = next.seats.find((s) => s.seatNo === seat.seatNo)!
    // Stack after settlement includes winnings; contribution delta remains the actual action amount.
    await c.tx.gamePokerAction.create({
      data: {
        handId: hand.id,
        roomId: c.room.id,
        userId,
        seq,
        seatNo: seat.seatNo,
        street: hand.street,
        action: input.action,
        actionSource: source,
        amount: after.total - before.total,
        ...(funded ? { nominalAmount: (after.nominalTotal ?? after.total) - (before.nominalTotal ?? before.total), waivedAmount: (after.nominalTotal ?? after.total) - (before.nominalTotal ?? before.total) - (after.total - before.total) } : {}),
        potAfter: next.seats.reduce((sum, s) => sum + s.total, 0),
        personaVersionId: input.personaSource === "session" ? null : agent?.currentVersionId,
        note: source === "human" ? null : input.note,
        elapsedMs: Math.max(
          0,
          now.getTime() - (c.room.actionStartedAt?.getTime() ?? c.room.actionDeadlineAt.getTime() - ACTION_WINDOW_MS),
        ),
        actionId: input.actionId,
        response: result,
        createdAt: now,
      },
    })
    await c.tx.gamePokerActionReceipt.create({
      data: {
        actionId: input.actionId,
        userId,
        roomId: c.room.id,
        response: result,
        ...(requestHash ? { requestHash } : {}),
        createdAt: now,
      },
    })
    if (resolution) await persistHandResolution(this.poker, c, resolution, context, h)
    await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: seq } })
    await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { lastSeenAt: now } })
    await saveHand(this.poker, c, hand, next)
    if (next.street === "settled") await startNext(this.poker, c)
    return result
  }
  async actBot(code: string, expected: { handId: string; scheduledAt: Date }, at?: Date) {
    return this.poker.withRoom(code, async (c) => {
      const now = c.now
      if (c.room.mode !== "practice" || c.room.status !== "running" ||
          c.room.currentHandId !== expected.handId || !c.room.botActionAt ||
          c.room.botActionAt.getTime() !== expected.scheduledAt.getTime() || c.room.botActionAt > now) return
      const hand = await c.tx.gamePokerHand.findUniqueOrThrow({ where: { id: expected.handId } })
      if (hand.status === "settled") return
      const h = engine(hand), seat = c.seats.find((s) => s.seatNo === h.actionOnSeat && s.participantKind === "bot")
      if (!seat) return
      const observation = botRollObservation(h, seat.seatNo)
      if (observation.pending) return this.rolls.submit(c, seat.userId, "choose", {
        roomCode: code, handId: hand.id, rollId: observation.pending.rollId,
        candidateIndex: chooseBotRollCandidate(observation, observation.pending.cardIndex, observation.pending.candidates),
        expectedActionSeq: hand.actionSeq, controlVersion: seat.controlVersion,
        actionId: rollActionId(hand.id, hand.actionSeq, seat.id, "roll_choose"),
      }, "rules_bot")
      const roll = chooseBotRoll(observation)
      if (roll && (h.street === "preflop" || h.street === "flop" || h.street === "turn")) return this.rolls.submit(c, seat.userId, "start", {
        roomCode: code, handId: hand.id, street: h.street, kind: roll.kind, cardIndex: roll.cardIndex, expectedFee: roll.fee,
        expectedActionSeq: hand.actionSeq, controlVersion: seat.controlVersion,
        actionId: rollActionId(hand.id, hand.actionSeq, seat.id, "roll_start"),
      }, "rules_bot")
      const me = h.seats.find((s) => s.seatNo === seat.seatNo)!
      const decision = chooseBotAction({ hole: [...me.hole], board: [...h.board],
        variant: h.variant,
        stack: me.stack, streetBet: me.streetBet, pot: h.seats.reduce((n, s) => n + s.total, 0),
        legal: legalActions(h, seat.seatNo),
      }, randomInt(1000000) / 1000000)
      const actionId = rollActionId(hand.id, hand.actionSeq, seat.id, "act")
      return this.submit(c, seat.userId, { ...decision, handId: hand.id, street: hand.street, actionId }, "rules_bot")
    }, at)
  }
  async expire(code: string, at?: Date) {
    return this.poker.withRoom(
      code,
      async (c) => {
        let now = c.now
        if (
          c.room.status !== "running" ||
          !c.room.actionDeadlineAt ||
          now < c.room.actionDeadlineAt ||
          !c.room.currentHandId
        )
          return
        let hand = await c.tx.gamePokerHand.findUniqueOrThrow({
            where: { id: c.room.currentHandId },
          }),
          h = engine(hand)
        if (hand.status === "settled") {
          await startNext(this.poker, c)
          return
        }
        if (h.actionOnSeat === null) return
        if (h.chipRulesVersion === "chips-v2") {
          await this.poker.lockFunds(c); now = sampleRoomTime(c)
          if (!c.room.actionDeadlineAt || now < c.room.actionDeadlineAt) return
          await this.expireFunded(c, hand, h)
          return
        }
        const seat = c.seats.find((s) => s.seatNo === h.actionOnSeat)!
        if (h.roll?.pending) {
          await this.rolls.submit(c, seat.userId, "choose", { roomCode: code, handId: hand.id, rollId: h.roll.pending.id, candidateIndex: 0, expectedActionSeq: hand.actionSeq, controlVersion: seat.controlVersion, actionId: rollActionId(hand.id, hand.actionSeq, seat.id, "timeout_roll_choose") }, "timeout")
          hand = await c.tx.gamePokerHand.findUniqueOrThrow({ where: { id: hand.id } })
          h = engine(hand)
        }
        const action = legalActions(h, seat.seatNo).toCall ? "fold" : "check"
        const agent = seat.controller !== "human" && seat.agentId
          ? await c.tx.gamePokerAgent.findFirst({
              where: { id: seat.agentId, userId: seat.userId },
              select: { currentVersionId: true },
            })
          : null
        const seq = hand.actionSeq + 1
        await c.tx.gamePokerAction.create({
          data: {
            handId: hand.id,
            roomId: c.room.id,
            userId: seat.userId,
            seq,
            seatNo: seat.seatNo,
            street: hand.street,
            action,
            potAfter: h.seats.reduce((sum, s) => sum + s.total, 0),
            isAuto: true,
            actionSource: "timeout",
            personaVersionId: agent?.currentVersionId,
            elapsedMs: ACTION_WINDOW_MS,
            actionId: randomUUID(),
            createdAt: now,
          },
        })
        await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: seq } })
        seat.leavePending = true
        const next = removeFromHand(h, seat.seatNo)
        await saveHand(this.poker, c, hand, next)
        if (c.seats.some((s) => s.id === seat.id)) await this.poker.refund(c, seat)
        if (next.street === "settled") await startNext(this.poker, c)
      },
      at,
    )
  }
  private async expireFunded(c: RoomContext, hand: import("@prisma/client").GamePokerHand, h: import("./engine/hand-runner").HandState): Promise<void> {
    const seat = c.seats.find(s => s.seatNo === h.actionOnSeat)
    if (!seat) return
    const seq = hand.actionSeq + 1, actionId = rollActionId(hand.id, hand.actionSeq, seat.id, "timeout")
    const context = roomResolutionContext(c, hand.id, seq, actionId, seat, "timeout")
    const action = legalFundedActions(h, seat.seatNo, fundedBetCapacity(h, seat.seatNo)).toCall ? "fold" : "check"
    const resolution = resolveHandCommand(h, { kind: "timeout", seatNo: seat.seatNo, scope: reserveScope(c, hand.id) }, context, createCardRegistry())
    await persistHandResolution(this.poker, c, resolution, context, h)
    await c.tx.gamePokerAction.create({ data: { handId: hand.id, roomId: c.room.id, userId: seat.userId, seq, seatNo: seat.seatNo, street: hand.street, action, amount: 0, nominalAmount: 0, waivedAmount: 0,
      potAfter: resolution.state.seats.reduce((n, s) => n + s.total, 0), isAuto: true, actionSource: "timeout", elapsedMs: Math.max(0, (c.room.actionDeadlineAt?.getTime() ?? c.now.getTime()) - (c.room.actionStartedAt?.getTime() ?? c.now.getTime())), actionId, createdAt: c.now } })
    await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: seq } })
    seat.leavePending = true
    await saveHand(this.poker, c, hand, resolution.state)
    if (c.seats.some(s => s.id === seat.id)) await this.poker.refund(c, seat)
    if (resolution.state.street === "settled") await startNext(this.poker, c)
  }
  async state(
    userId: string,
    code: string,
    perspective: "owner" | "public" = "owner",
    heartbeat = false,
    now?: Date,
    audience: "desktop" | "decision" | "bearer" = "decision",
  ) {
    return this.poker.withRoom(
      code,
      (c) => this.view(c, userId, perspective, heartbeat, true, audience),
      now,
      false,
    )
  }
  async view(
    c: RoomContext,
    userId: string,
    perspective: "owner" | "public",
    heartbeat: boolean,
    includeVersions = false,
    audience: "desktop" | "decision" | "bearer" = "decision",
  ) {
    if (audience === "bearer") audience = isCardRoom(c.room) ? "decision" : "desktop"
    if (isCardRoom(c.room) && audience === "decision") perspective = "public"
    const me = c.seats.find((s) => s.userId === userId),
      own = perspective === "owner" && !!me
    if (heartbeat && me && (audience === "desktop" ? me.controller === "human" : (me.controller ?? "ai") === "ai")) {
      await c.tx.gamePokerSeat.update({ where: { id: me.id }, data: { lastSeenAt: c.now } })
      me.lastSeenAt = c.now
    }
    const { hot, archived, hand } = await currentHand(c)
    const h = hot ? engine(hot) : null
    const session = await c.tx.gameSession.findUnique({ where: { userId_gameKind_gameRoomId: { userId, gameKind: "poker", gameRoomId: c.room.id } } })
    const controlHistory = !me ? await c.tx.gamePokerControlHistory.findUnique({ where: { roomId_userId: { roomId: c.room.id, userId } } }) : null
    const policy: PokerViewPolicy = { audience, perspective: me ? perspective : "public", everJoined: !!session, mode: c.room.mode, cardMode: isCardRoom(c.room) }
    let participating =
      !!hand &&
      !!me &&
      (me.joinedHandNo ?? 0) <= hand.handNo &&
      !!h?.seats.some((s) => s.seatNo === me.seatNo)
    const legal =
      h && own && participating
        ? h.chipRulesVersion === "chips-v2" ? legalFundedActions(h, me!.seatNo, fundedBetCapacity(h, me!.seatNo)) : legalActions(h, me!.seatNo)
        : { actions: [], toCall: 0, minRaiseTo: 0, maxRaiseTo: 0 }
    const logRecords = archived ? [...archived.actions].sort((a, b) => b.seq - a.seq).slice(0, 1000) : hand
      ? await c.tx.gamePokerAction.findMany({ where: { handId: hand.id }, orderBy: { seq: "desc" }, take: 1000 }) : []
    const records = archived ? [...archived.actions].filter(a => !a.action.startsWith("roll_")).sort((a, b) => b.seq - a.seq).slice(0, 30) : hand
      ? await c.tx.gamePokerAction.findMany({
          where: { handId: hand.id, action: { notIn: ["roll_start", "roll_choose"] } },
          orderBy: { seq: "desc" }, take: 30,
        }) : []
    const participants =
      archived ? archived.seats : hand
        ? await c.tx.gamePokerHandSeat.findMany({
            where: { handId: hand.id },
            take: 10,
          })
        : []
    participating = participating && participants.some(p => p.userId === userId && p.seatNo === me?.seatNo && (p.admissionId ? p.admissionId === me?.id : (me?.joinedHandNo ?? 0) <= hand!.handNo))
    const versions =
      includeVersions && own
        ? await c.tx.gamePokerAgentVersion.findMany({
            where: {
              id: {
                in: records
                  .filter((a) => a.userId === userId && a.personaVersionId)
                  .map((a) => a.personaVersionId!),
              },
            },
            select: { id: true, versionNo: true, persona: true },
            take: 30,
          })
        : []
    const sources = archived ? archived.actions : hand?.status === "settled" ? await c.tx.gamePokerAction.groupBy({
      by: ["userId", "seatNo", "actionSource", "isAuto"], where: { handId: hand.id },
      orderBy: [{ userId: "asc" }, { seatNo: "asc" }, { actionSource: "asc" }, { isAuto: "asc" }], take: 100,
    }) : []
    const recentActions = records.filter(a => !a.action.startsWith("roll_")).reverse().map((a) => ({
      seq: a.seq,
      seatNo: a.seatNo,
      displayName: participants.find((s) => s.seatNo === a.seatNo)?.displayName,
      street: a.street,
      action: a.action,
      amount: a.amount,
      potAfter: a.potAfter,
      isAuto: a.isAuto,
      actionSource: a.actionSource ?? (a.isAuto ? "timeout" : "mcp"),
      ...(own && a.userId === userId
        ? {
            note: a.note,
            personaVersionId: a.personaVersionId,
            ...(includeVersions
              ? { personaVersion: versions.find((v) => v.id === a.personaVersionId) ?? null }
              : {}),
          }
        : {}),
    }))
    const agent =
      own && me?.agentId
        ? await c.tx.gamePokerAgent.findFirst({
            where: { id: me.agentId, userId },
            select: { persona: true },
          })
        : null
    const deadlineMs = c.room.actionDeadlineAt
      ? Math.max(0, c.room.actionDeadlineAt.getTime() - c.now.getTime())
      : null
    const isRoomOwner = perspective === "owner" && c.room.ownerUserId === userId
    const eligible = c.seats.filter(nextHandEligible)
    const rollEnabled = !!(c.room.ruleOptions as { roll?: boolean } | null)?.roll
    const statSeats = [...c.seats, ...participants.filter(p => !c.seats.some(s => s.seatNo === p.seatNo))]
    const rollStats = rollEnabled ? await projectRollStats(c, hand?.id ?? null, statSeats) : undefined
    const rollLedger = rollEnabled && hand ? projectRollLedger({
      roomId: c.room.id, userId, hand, participants, state: h,
      archivedRolls: archived?.rolls, archivedActions: archived?.actions,
    }) : undefined
    const handLog = hand ? projectHandLog({
      roomId: c.room.id, hand, participants, actions: logRecords,
      rolls: h?.roll?.history ?? archived?.rolls.map(record => record.data as unknown as import("./engine/hand-runner").RollHistory) ?? [],
      pendingRollId: h?.roll?.pending?.id ?? null,
      cards: h?.cards?.used ?? archived?.cards?.used,
    }) : undefined
    const potContributions = hand ? projectPotContributions({
      roomId: c.room.id, userId, hand, participants, state: h, archivedActions: archived?.actions,
    }) : undefined
    const chipState = audience === "desktop" && hand ? await projectChipState(c.tx,hand,participants,
      archived ? archived.rolls.map(r=>({id:r.id,seatNo:r.seatNo,fee:(r.data as unknown as {fee:number}).fee})) : h?.roll?.history ?? [],
      archived?.actions) : undefined
    const cardState = h ?? (archived?.cards ? { archived: true as const, cards: archived.cards, street: hand!.street, seats: participants.map(p => ({ seatNo: p.seatNo, hole: p.holeCards as string[] })) } : null)
    const cards = cardState ? projectCardView(cardState, { audience, perspective, handId: hand!.id, actionSeq: hand!.actionSeq, nowMs: c.now.getTime(), ...(own && me && participants.some(p => p.admissionId === me.id && p.userId === userId) ? { self: { userId, admissionId: me.id, seatNo: me.seatNo, controlVersion: me.controlVersion } } : {}) }) : undefined
    const reserve = hand ? projectReserveView({ roomId: c.room.id, handId: hand.id, status: hand.status, userId, participants, state: h?.reserve ?? archived?.reserve }) : undefined
    return {
      ...(cards ? { cards } : {}), ...(reserve ? { reserve } : {}),
      ...(h?.chipRulesVersion === "chips-v2" && own && participating ? { paymentVersion: betPaymentVersion(h, me!.seatNo, hand!.id, hand!.actionSeq, me!.controlVersion) } : {}),
      ...(handLog ? { handLog } : {}),
      ...(potContributions ? { potContributions } : {}),
      ...(chipState ? {chipState} : {}),
      ...(rollStats ? { rollStats } : {}),
      ...(rollLedger ? { rollLedger } : {}),
      roomCode: c.room.code,
      mode: c.room.mode,
      ...resolveRules(c.room as unknown as Parameters<typeof resolveRules>[0]),
      rules: resolveRules(c.room as unknown as Parameters<typeof resolveRules>[0]),
      roll: h ? projectRollView(h, own && participating ? me!.seatNo : null) : { enabled: !!(c.room.ruleOptions as { roll?: boolean } | null)?.roll, ...(c.room.rollPricingVersion ? { pricingVersion: c.room.rollPricingVersion } : {}) },
      actionSeq: hand?.actionSeq ?? 0,
      controller: me ? me.controller ?? "ai" : null,
      controlVersion: me?.controlVersion ?? controlHistory?.controlVersion ?? 0,
      handoffPending: me?.handoffPending ?? controlHistory?.joinPending ?? false,
      requiresJoinApproval: !!controlHistory,
      pauseReason: own ? me?.pauseReason ?? null : null,
      nextHandAt: c.room.nextHandAt?.toISOString() ?? null,
      awaitingReady: (c.room.handNo === 0 || hand?.status === "settled") && c.room.status !== "closed",
      isRoomOwner,
      canStart: isRoomOwner && !c.room.closeRequested && c.room.status !== "closed" && (c.room.handNo === 0 || hand?.status === "settled") && eligible.length >= 2 && eligible.some(s => s.participantKind !== "bot") && eligible.every(s => preparedForNextHand(s, c.room)),
      settlement: hand ? projectSettlement(hand, participants, sources as unknown as Parameters<typeof projectSettlement>[2], userId, policy) : null,
      ownerUserId: c.room.ownerUserId,
      name: c.room.name,
      status: c.room.status,
      buyIn: c.room.buyIn,
      maxSeats: c.room.maxSeats,
      handId: hand?.id ?? null,
      handNo: c.room.handNo,
      street: hand?.street ?? null,
      board: h?.board ?? (Array.isArray(hand?.board) ? hand.board.filter((card): card is string => typeof card === "string") : []),
      pot: hand?.pot ?? 0,
      dealerSeat: c.room.dealerSeat,
      actionOnSeat: h?.actionOnSeat ?? null,
      deadlineMs,
      cursor: `${hand?.handNo ?? 0}:${hand?.actionSeq ?? 0}`,
      mySeatNo: me?.seatNo ?? null,
      seats: [...c.seats, ...participants.filter((p) => !c.seats.some((s) => s.seatNo === p.seatNo)).map((p) => ({
        ...p, roomId: c.room.id, stack: p.endingStack ?? h?.seats.find((s) => s.seatNo === p.seatNo)?.stack ?? 0,
        joinedHandNo: hand!.handNo, status: p.folded ? "folded" : "left", lastSeenAt: new Date(0),
        controller: "ai", controlVersion: 0, handoffPending: false, leavePending: false, ghost: true,
      }))].map((s) => {
        const p =
          hand && (s.joinedHandNo ?? 0) <= hand.handNo && participants.some((p) => p.seatNo === s.seatNo && p.userId === s.userId && ("ghost" in s || !p.admissionId || p.admissionId === s.id))
            ? h?.seats.find((p) => p.seatNo === s.seatNo)
            : undefined
        const visible = canSeeHole(userId, s.userId, s.participantKind, p?.folded ?? false, h?.showdownSeats.includes(s.seatNo) ?? false, participating, policy)
        return {
          seatNo: s.seatNo,
          isHistorical: "ghost" in s,
          nextHandEligible: !("ghost" in s) && nextHandEligible(s),
          readyForNextHand: !("ghost" in s) && (c.room.handNo === 0 || hand?.status === "settled") && preparedForNextHand(s, c.room),
          inCurrentHand: !!p,
          participantKind: s.participantKind,
          ...(s.participantKind === "bot" && !("ghost" in s) ? { botId: s.id, leavePending: s.leavePending } : {}),
          controller: s.participantKind === "bot" ? null : s.controller ?? "ai",
          controlVersion: s.controlVersion ?? 0,
          handoffPending: s.handoffPending ?? false,
          displayName: s.displayName,
          stack: s.stack,
          status: s.status,
          isMe: s.userId === userId,
          streetBet: p?.streetBet ?? 0,
          ...(p && h?.roll ? { rollCount: h.roll.counts[s.seatNo] ?? 0, rollPaid: h.roll.paid[s.seatNo] ?? 0, pendingCompensation: h.roll.released ? 0 : h.roll.credits[s.seatNo] ?? 0 } : {}),
          aiState:
            s.participantKind === "bot" ? "bot" : s.status === "sitting_out"
              ? "sitting_out"
              : c.now.getTime() - s.lastSeenAt.getTime() > 60000
                ? "offline"
                : "online",
          ...(visible && p ? { hole: p.hole } : {}),
        }
      }),
      recentActions,
      ...(own
        ? {
            hole: participating ? (h?.seats.find((s) => s.seatNo === me!.seatNo)?.hole ?? []) : [],
            persona: agent?.persona ?? "",
            legalActions: participating && !h?.roll?.pending ? legal.actions : [],
            toCall: legal.toCall,
            minRaiseTo: legal.minRaiseTo,
            maxRaiseTo: legal.maxRaiseTo,
          }
        : {}),
      deckRemaining: h?.deck.length ?? (c.room.variant === "short32" ? 32 : 52),
    }
  }
}
