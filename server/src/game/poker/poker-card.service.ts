import { createHash } from "node:crypto"
import { Injectable } from "@nestjs/common"
import type { PokerCardPlayInput, PokerCardChooseInput, PokerCardResult } from "@synapse/shared/game-contracts"
import { PokerService, sampleRoomTime, json } from "./poker.service"
import { engine, saveHand } from "./poker-lifecycle"
import { assertController, type PokerCaller } from "./poker-control"
import { assertPokerModeAccess, isCardRoom } from "./poker-mode-policy"
import { resolveHandCommand } from "./engine/resolve-hand"
import { createCardRegistry } from "./engine/cards/catalog-v1"
import { persistHandResolution, reserveScope, roomResolutionContext } from "./poker-resolution"
import { reject } from "./poker-error"
import { CardRuleError } from "./engine/cards/types"

@Injectable()
export class PokerCardService {
  constructor(readonly poker: PokerService) {}
  play(userId: string, input: PokerCardPlayInput, caller: PokerCaller = "human", now?: Date): Promise<PokerCardResult> { return this.submit(userId, "play", input, caller, now) }
  choose(userId: string, input: PokerCardChooseInput, caller: PokerCaller = "human", now?: Date): Promise<PokerCardResult> { return this.submit(userId, "choose", input, caller, now) }
  private async submit(userId: string, operation: "play" | "choose", input: PokerCardPlayInput | PokerCardChooseInput, caller: PokerCaller, now?: Date): Promise<PokerCardResult> {
    return this.poker.withRoom(input.roomCode, async c => {
      assertPokerModeAccess(c.room, caller, `card.${operation}`)
      if (!isCardRoom(c.room) || c.room.cardRulesVersion !== "cards-v1") reject("POKER_CARD_MODE_UNAVAILABLE", "房间未启用卡牌模式。")
      if (caller !== "human") reject("POKER_CARD_AI_DISABLED", "卡牌房当前仅支持真人操作。")
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actionId)) reject("POKER_CARD_INVALID_SELECTION", "操作标识无效。")
      const extra = operation === "play" ? ["instanceId" in input ? input.instanceId : null, "selections" in input ? Object.entries(input.selections).sort(([a], [b]) => a.localeCompare(b)) : null] : ["choiceId" in input ? input.choiceId : null, "candidateIndex" in input ? input.candidateIndex : null]
      const requestHash = createHash("sha256").update(JSON.stringify([`card.${operation}`, userId, input.roomCode, input.handId, input.street, input.expectedActionSeq, input.controlVersion, input.expectedPaymentVersion, ...extra])).digest("hex")
      const previous = await c.tx.gamePokerActionReceipt.findUnique({ where: { actionId: input.actionId } })
      if (previous) {
        if (previous.userId !== userId || previous.roomId !== c.room.id || previous.requestHash !== requestHash) reject("POKER_ILLEGAL_ACTION", "actionId已用于不同请求。")
        return previous.response as unknown as PokerCardResult
      }
      const seat = c.seats.find(s => s.userId === userId && s.participantKind !== "bot")
      if (!seat) reject("POKER_SEAT_NOT_FOUND", "座位不存在。")
      assertController(seat, caller, input.controlVersion)
      const hand = c.room.currentHandId ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } }) : null
      if (!hand || hand.id !== input.handId || hand.status !== "running" || c.room.status !== "running" || hand.actionSeq !== input.expectedActionSeq || hand.street !== input.street || seat.status !== "active") reject("POKER_STALE_ACTION", "行动点已变更，请重新读取牌桌。")
      await this.poker.lockFunds(c); sampleRoomTime(c)
      if (!c.room.actionDeadlineAt || c.now >= c.room.actionDeadlineAt) reject("POKER_STALE_ACTION", "行动已过期。")
      const before = engine(hand), context = roomResolutionContext(c, hand.id, hand.actionSeq + 1, input.actionId, seat, "human")
      let resolution
      try { resolution = resolveHandCommand(before, operation === "play" ? { kind: "card.play", input: input as PokerCardPlayInput, scope: reserveScope(c, hand.id) } : { kind: "card.choose", input: input as PokerCardChooseInput, scope: reserveScope(c, hand.id) }, context, createCardRegistry()) }
      catch (error) { if (error instanceof CardRuleError) reject(error.code, "卡牌请求已失效或当前不能使用。") ; throw error }
      const played = resolution.state.cards!.used.find(r => r.seq === context.actionSeq)
      const result: PokerCardResult = { ok: true, handId: hand.id, actionSeq: context.actionSeq, cursor: `${hand.handNo}:${context.actionSeq}`, status: operation === "choose" ? "completed" : played?.status ?? "completed" }
      await persistHandResolution(this.poker, c, resolution, context, before)
      await c.tx.gamePokerAction.create({ data: { handId: hand.id, roomId: c.room.id, userId, seq: context.actionSeq, seatNo: seat.seatNo, street: hand.street, action: `card_${operation}`, amount: 0, nominalAmount: 0, waivedAmount: 0,
        actionSource: "human", isAuto: false, potAfter: resolution.state.seats.reduce((n, s) => n + s.total, 0), actionId: input.actionId, elapsedMs: Math.max(0, c.now.getTime() - (c.room.actionStartedAt?.getTime() ?? c.now.getTime())), response: json(result), createdAt: c.now } })
      await c.tx.gamePokerActionReceipt.create({ data: { actionId: input.actionId, userId, roomId: c.room.id, requestHash, response: json(result), createdAt: c.now } })
      await c.tx.gamePokerHand.update({ where: { id: hand.id }, data: { actionSeq: context.actionSeq } })
      await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { lastSeenAt: c.now } })
      await saveHand(this.poker, c, hand, resolution.state, { preserveDeadline: true })
      return result
    }, now)
  }
}
