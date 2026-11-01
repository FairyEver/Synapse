import { Injectable } from "@nestjs/common"
import { createHash, randomInt } from "node:crypto"
import type { PokerRollChooseInput, PokerRollStartInput, PokerRollResult } from "@synapse/shared/game-contracts"
import { chooseRollCard, startRoll, quoteRoll } from "./engine/hand-runner"
import { PokerService, json, type RoomContext } from "./poker.service"
import { engine, saveHand, ACTION_WINDOW_MS } from "./poker-lifecycle"
import { assertController, type PokerCaller } from "./poker-control"
import { reject } from "./poker-error"

type RollSource = PokerCaller | "rules_bot" | "timeout"
type RollInput = PokerRollStartInput | PokerRollChooseInput
export function rollActionId(handId: string, seq: number, admissionId: string, operation: string): string {
  const key = createHash("sha256").update(JSON.stringify([handId, seq, admissionId, operation])).digest("hex")
  return `${key.slice(0,8)}-${key.slice(8,12)}-4${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`
}
@Injectable()
export class PokerRollService {
  constructor(readonly poker: PokerService) {}
  start(userId: string, input: PokerRollStartInput, now = new Date(), caller: PokerCaller = "mcp") {
    return this.poker.withRoom(input.roomCode, c => this.submit(c, userId, "start", input, caller), now)
  }
  choose(userId: string, input: PokerRollChooseInput, now = new Date(), caller: PokerCaller = "mcp") {
    return this.poker.withRoom(input.roomCode, c => this.submit(c, userId, "choose", input, caller), now)
  }
  /** Internal entry only: scheduler already holds the room transaction. Never expose source to clients. */
  async submit(c: RoomContext, userId: string, operation: "start" | "choose", input: RollInput, source: RollSource): Promise<PokerRollResult> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(input.actionId)) reject("POKER_ILLEGAL_ACTION", "actionId须为UUID。")
    // Enumerate semantic parameters: field order/extra transport metadata never changes the fingerprint.
    const intent = operation === "start" ? (() => { const p = input as PokerRollStartInput; return [p.street,p.kind,p.cardIndex,p.expectedFee] })()
      : (() => { const p = input as PokerRollChooseInput; return [p.rollId,p.candidateIndex] })()
    const requestHash = createHash("sha256").update(JSON.stringify([operation, userId, input.roomCode, input.handId, input.expectedActionSeq, input.controlVersion, ...intent])).digest("hex")
    const previous = await c.tx.gamePokerActionReceipt.findUnique({ where: { actionId: input.actionId } })
    if (previous) {
      if (previous.userId !== userId || previous.roomId !== c.room.id || previous.requestHash !== requestHash)
        reject("POKER_ILLEGAL_ACTION", "actionId已用于不同请求。")
      return previous.response as unknown as PokerRollResult
    }
    const seat = c.seats.find(s => s.userId === userId)
    if (!seat || (source === "rules_bot" ? c.room.mode !== "practice" || seat.participantKind !== "bot" : source !== "timeout" && seat.participantKind === "bot")) reject("POKER_SEAT_NOT_FOUND", "座位不存在。")
    if (source === "human" || source === "mcp") assertController(seat, source, input.controlVersion)
    const hand = c.room.currentHandId ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } }) : null
    if (c.room.status !== "running" || !hand || hand.status !== "running" || hand.id !== input.handId || hand.actionSeq !== input.expectedActionSeq || !c.room.actionDeadlineAt || (source !== "timeout" && c.now >= c.room.actionDeadlineAt)) reject("POKER_STALE_ACTION", "行动已过期，请重新读取牌桌。")
    const participants = await c.tx.gamePokerHandSeat.findMany({ where: { handId: hand.id }, take: 10 })
    const participant = participants.find(p => p.admissionId === seat.id && p.userId === userId && p.seatNo === seat.seatNo)
    const state = engine(hand)
    if (!participant || seat.status !== "active" || state.actionOnSeat !== seat.seatNo) reject("POKER_NOT_YOUR_TURN", "当前不能换牌。")
    await this.poker.lockFunds(c)
    let next
    try {
      if (operation === "start") {
        const p = input as PokerRollStartInput
        if (p.street !== hand.street) reject("POKER_STALE_ACTION", "阶段已改变。")
        const quote = quoteRoll(state, seat.seatNo)
        if (!quote.enabled || !["normal", "super"].includes(p.kind)) reject("POKER_ROLL_ILLEGAL_ACTION", "当前不能换牌。")
        if (p.expectedFee !== quote[p.kind].fee) reject("POKER_ROLL_PRICE_CHANGED", "费用已改变，请重新读取报价。")
        if (!quote[p.kind].available) reject(quote[p.kind].reason ?? "POKER_ROLL_ILLEGAL_ACTION", "当前不能换牌。")
        next = startRoll(state, seat.seatNo, { rollId: input.actionId, kind: p.kind, cardIndex: p.cardIndex, fee: p.expectedFee }, randomInt)
      } else {
        const p = input as PokerRollChooseInput
        next = chooseRollCard(state, seat.seatNo, p.rollId, p.candidateIndex, randomInt)
      }
    } catch (error) {
      if (error instanceof Error && /^POKER_ROLL_/.test(error.message)) reject(error.message, "换牌请求无效，请重新读取牌桌。")
      throw error
    }
    const rollId = operation === "start" ? input.actionId : (input as PokerRollChooseInput).rollId
    const record = next.roll!.history.find(r => r.id === rollId)!, seq = hand.actionSeq + 1
    if (operation === "start") {
      await c.tx.gamePokerRoll.create({ data: { id: rollId, roomId: c.room.id, handId: hand.id, userId, admissionId: seat.id, seatNo: seat.seatNo, startSeq: seq, data: json(record), createdAt: c.now, completedAt: record.selectedIndex === null ? null : c.now } })
      await this.poker.hall.freezeTransfers(c.tx, Object.entries(record.compensations).filter(([, amount]) => amount > 0).map(([seatNo, amount]) => {
        const recipient = participants.find(p => p.seatNo === Number(seatNo))
        if (!recipient?.admissionId) throw new Error("Roll recipient admission missing")
        return { sourceId: rollId, settlementId: hand.id, gameKind: "poker", gameRoomId: c.room.id, userId: recipient.userId, admissionId: recipient.admissionId, funding: c.room.mode === "practice" ? "practice" as const : "points" as const, amount }
      }), c.now)
    } else await c.tx.gamePokerRoll.update({ where: { id: rollId }, data: { data: json(record), chooseSeq: seq, completedAt: c.now } })
    const result: PokerRollResult = { ok: true, handId: hand.id, rollId, actionSeq: seq, cursor: `${hand.handNo}:${seq}`, status: next.roll!.pending ? "choice_required" : "completed" }
    await c.tx.gamePokerAction.create({ data: { handId: hand.id, roomId: c.room.id, userId, seq, seatNo: seat.seatNo, street: hand.street, action: `roll_${operation}`, actionSource: source, isAuto: source === "timeout", amount: 0, rollId, potAfter: next.seats.reduce((n,s) => n+s.total,0), elapsedMs: Math.max(0,c.now.getTime() - (c.room.actionDeadlineAt.getTime() - ACTION_WINDOW_MS)), actionId: input.actionId, response: json(result), createdAt: c.now } })
    await c.tx.gamePokerActionReceipt.create({ data: { actionId: input.actionId, userId, roomId: c.room.id, requestHash, response: json(result), createdAt: c.now } })
    await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: seq } })
    if (source === "human" || source === "mcp") await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { lastSeenAt: c.now } })
    await saveHand(this.poker, c, hand, next, { preserveDeadline: true })
    return result
  }
}
