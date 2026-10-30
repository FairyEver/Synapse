import { Injectable } from "@nestjs/common"
import { randomUUID } from "node:crypto"
import type { ActionKind } from "./engine/betting"
import { act, legalActions, removeFromHand } from "./engine/hand-runner"
import { PokerService, json, type RoomContext } from "./poker.service"
import { engine, saveHand, startNext, ACTION_WINDOW_MS } from "./poker-lifecycle"
import { reject } from "./poker-error"
export interface ActionInput {
  handId: string
  street: string
  actionId: string
  action: ActionKind
  to?: number
  note?: string
  personaSource?: "game" | "session"
}
@Injectable()
export class PokerActionService {
  constructor(readonly poker: PokerService) {}
  async act(userId: string, code: string, input: ActionInput, now = new Date()) {
    return this.poker.withRoom(
      code,
      async (c) => {
        const previous = await c.tx.gamePokerActionReceipt.findUnique({
          where: { actionId: input.actionId },
        })
        if (previous && previous.userId === userId && previous.roomId === c.room.id)
          return previous.response
        const seat = c.seats.find((s) => s.userId === userId)
        if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        if (c.room.status !== "running") reject("POKER_ROOM_CLOSED", "房间尚未开始或已暂停。")
        const hand = c.room.currentHandId
          ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } })
          : null
        if (!hand || hand.status === "settled")
          reject("POKER_HAND_NOT_ACTIVE", "当前没有进行中的手牌。")
        const h = engine(hand),
          legal = legalActions(h, seat.seatNo)
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
        let next
        try {
          next = act(h, seat.seatNo, input)
        } catch {
          reject("POKER_ILLEGAL_ACTION", "动作或数额不合法。", details)
        }
        const agent = seat.agentId
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
            amount: after.total - before.total,
            potAfter: next.seats.reduce((sum, s) => sum + s.total, 0),
            personaVersionId: input.personaSource === "session" ? null : agent?.currentVersionId,
            note: input.note,
            elapsedMs: Math.max(
              0,
              now.getTime() - (c.room.actionDeadlineAt.getTime() - ACTION_WINDOW_MS),
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
            createdAt: now,
          },
        })
        await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: seq } })
        await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { lastSeenAt: now } })
        await saveHand(this.poker, c, hand, next)
        if (next.street === "settled") await startNext(this.poker, c)
        return result
      },
      now,
    )
  }
  async expire(code: string, now = new Date()) {
    return this.poker.withRoom(
      code,
      async (c) => {
        if (
          c.room.status !== "running" ||
          !c.room.actionDeadlineAt ||
          now < c.room.actionDeadlineAt ||
          !c.room.currentHandId
        )
          return
        const hand = await c.tx.gamePokerHand.findUniqueOrThrow({
            where: { id: c.room.currentHandId },
          }),
          h = engine(hand)
        if (hand.status === "settled") {
          await startNext(this.poker, c)
          return
        }
        if (h.actionOnSeat === null) return
        const seat = c.seats.find((s) => s.seatNo === h.actionOnSeat)!
        const action = legalActions(h, seat.seatNo).toCall ? "fold" : "check"
        const agent = seat.agentId
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
      now,
    )
  }
  async state(
    userId: string,
    code: string,
    perspective: "owner" | "public" = "owner",
    heartbeat = false,
    now = new Date(),
  ) {
    return this.poker.withRoom(
      code,
      (c) => this.view(c, userId, perspective, heartbeat, true),
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
  ) {
    const me = c.seats.find((s) => s.userId === userId),
      own = perspective === "owner" && !!me
    if (heartbeat && me) {
      await c.tx.gamePokerSeat.update({ where: { id: me.id }, data: { lastSeenAt: c.now } })
      me.lastSeenAt = c.now
    }
    const hand = c.room.currentHandId
      ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } })
      : null
    const h = hand ? engine(hand) : null
    const participating =
      !!hand &&
      !!me &&
      (me.joinedHandNo ?? 0) <= hand.handNo &&
      !!h?.seats.some((s) => s.seatNo === me.seatNo)
    const legal =
      h && own && participating
        ? legalActions(h, me!.seatNo)
        : { actions: [], toCall: 0, minRaiseTo: 0, maxRaiseTo: 0 }
    const records = hand
      ? await c.tx.gamePokerAction.findMany({
          where: { handId: hand.id },
          orderBy: { seq: "desc" },
          take: 30,
        })
      : []
    const participants =
      hand && records.length > 0
        ? await c.tx.gamePokerHandSeat.findMany({
            where: { handId: hand.id },
            select: { seatNo: true, displayName: true },
            take: 10,
          })
        : []
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
    const recentActions = records.reverse().map((a) => ({
      seq: a.seq,
      seatNo: a.seatNo,
      displayName: participants.find((s) => s.seatNo === a.seatNo)?.displayName,
      street: a.street,
      action: a.action,
      amount: a.amount,
      potAfter: a.potAfter,
      isAuto: a.isAuto,
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
    return {
      roomCode: c.room.code,
      name: c.room.name,
      status: c.room.status,
      buyIn: c.room.buyIn,
      maxSeats: c.room.maxSeats,
      handId: hand?.id ?? null,
      handNo: c.room.handNo,
      street: hand?.street ?? null,
      board: h?.board ?? [],
      pot: hand?.pot ?? 0,
      dealerSeat: c.room.dealerSeat,
      actionOnSeat: h?.actionOnSeat ?? null,
      deadlineMs,
      cursor: `${hand?.handNo ?? 0}:${hand?.actionSeq ?? 0}`,
      mySeatNo: own ? me!.seatNo : null,
      seats: c.seats.map((s) => {
        const p =
          hand && (s.joinedHandNo ?? 0) <= hand.handNo
            ? h?.seats.find((p) => p.seatNo === s.seatNo)
            : undefined
        const visible =
          own &&
          (s.userId === userId ||
            (participating && h?.showdownSeats.includes(s.seatNo) && !p?.folded))
        return {
          seatNo: s.seatNo,
          displayName: s.displayName,
          stack: s.stack,
          status: s.status,
          isMe: s.userId === userId,
          streetBet: p?.streetBet ?? 0,
          aiState:
            s.status === "sitting_out"
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
            legalActions: legal.actions,
            toCall: legal.toCall,
            minRaiseTo: legal.minRaiseTo,
            maxRaiseTo: legal.maxRaiseTo,
          }
        : {}),
      deckRemaining: h?.deck.length ?? 52,
    }
  }
}
