import { Injectable } from "@nestjs/common"
import { POKER_MAX_SEATS } from "@synapse/shared/game-contracts"
import { PokerService, creationIdentity } from "./poker.service"
import { startNext } from "./poker-lifecycle"
import { reject } from "./poker-error"

@Injectable()
export class PokerBotService {
  constructor(private readonly poker: PokerService) {}
  async add(userId: string, code: string, creationId: string, now = new Date()) {
    const id = creationIdentity(userId, "bot", creationId)
    return this.poker.withRoom(code, async (c) => {
      if (c.room.ownerUserId !== userId || c.room.mode !== "practice")
        reject("POKER_BOT_NOT_ALLOWED", "仅陪练房房主可管理机器人。")
      const previous = await c.tx.gamePokerBot.findUnique({ where: { id } })
      if (previous) {
        if (previous.roomId !== c.room.id) reject("POKER_ILLEGAL_ACTION", "创建标识已用于其他房间。")
        return { botId: previous.id, seatNo: previous.seatNo }
      }
      if (c.room.status === "closed" || c.room.closeRequested)
        reject("POKER_ROOM_CLOSED", "房间已解散或正在解散。")
      const humans = c.seats.filter((s) => s.participantKind !== "bot").length
      const maxSeats = Math.min(c.room.maxSeats, POKER_MAX_SEATS)
      if (c.seats.length >= maxSeats - (humans ? 0 : 1))
        reject("POKER_ROOM_FULL", "房间已满或须为真人保留座位。")
      const seatNo = Array.from({ length: maxSeats }, (_, i) => i).find((n) => !c.seats.some((s) => s.seatNo === n))!
      await c.tx.gamePokerBot.create({ data: { id, roomId: c.room.id, seatNo, createdAt: now } })
      const seat = await c.tx.gamePokerSeat.create({ data: {
        id, userId: `bot:${id}`, participantKind: "bot", roomId: c.room.id, seatNo,
        displayName: `陪练 ${seatNo + 1}`, stack: c.room.buyIn, joinedHandNo: c.room.handNo + 1, lastSeenAt: now,
      } })
      c.seats.push(seat)
      await startNext(this.poker, c)
      return { botId: id, seatNo }
    }, now)
  }
  async remove(userId: string, code: string, botId: string, now = new Date()) {
    return this.poker.withRoom(code, async (c) => {
      if (c.room.ownerUserId !== userId || c.room.mode !== "practice")
        reject("POKER_BOT_NOT_ALLOWED", "仅陪练房房主可管理机器人。")
      const record = await c.tx.gamePokerBot.findFirst({ where: { id: botId, roomId: c.room.id } })
      if (!record) reject("POKER_SEAT_NOT_FOUND", "机器人不存在。")
      const seat = c.seats.find((s) => s.id === botId && s.participantKind === "bot")
      if (!seat) return { pending: false }
      if (c.room.status === "running" && (seat.joinedHandNo ?? 0) <= c.room.handNo && ["active", "folded", "allin"].includes(seat.status)) {
        await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { leavePending: true } })
        return { pending: true }
      }
      await this.poker.refund(c, seat)
      await startNext(this.poker, c)
      return { pending: false }
    }, now)
  }
}
