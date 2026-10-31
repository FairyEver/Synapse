import { Injectable, InternalServerErrorException } from "@nestjs/common"
import { NotificationService } from "../../notifications/notification.service"
import { PokerService } from "./poker.service"
import { reject } from "./poker-error"
import { engine, ACTION_WINDOW_MS } from "./poker-lifecycle"
import { normalizePublicAppUrl } from "../../common/public-app-url"
@Injectable()
export class PokerNudgeService {
  constructor(
    private readonly poker: PokerService,
    private readonly notifications: NotificationService,
  ) {}
  async nudge(userId: string, code: string, seatNo: number, now = new Date()) {
    const notice = await this.poker.withRoom(
      code,
      async (c) => {
        if (!c.seats.some((s) => s.userId === userId))
          reject("POKER_SEAT_NOT_FOUND", "只有同桌选手可以提醒。")
        const target = c.seats.find((s) => s.seatNo === seatNo)
        if (target?.participantKind === "bot") reject("POKER_BOT_NOT_ALLOWED", "程序机器人不接收提醒。")
        if (!target || !c.room.currentHandId || !c.room.actionDeadlineAt)
          reject("POKER_SEAT_NOT_FOUND", "该座位不在等待行动。")
        const hand = await c.tx.gamePokerHand.findUniqueOrThrow({
          where: { id: c.room.currentHandId },
        })
        if (
          engine(hand).actionOnSeat !== seatNo ||
          now.getTime() - (c.room.actionDeadlineAt.getTime() - ACTION_WINDOW_MS) < 60000
        )
          reject("POKER_ILLEGAL_ACTION", "仅可提醒已等待一分钟的行动位。")
        if (target.lastNudgedAt && now.getTime() - target.lastNudgedAt.getTime() < 300000)
          reject("POKER_NUDGE_RATE_LIMITED", "该座位5分钟内已被提醒过。")
        const publicUrl = normalizePublicAppUrl(process.env.APP_PUBLIC_URL ?? "")
        if (!publicUrl) throw new InternalServerErrorException("APP_PUBLIC_URL 未配置，无法生成游戏链接。")
        const record = await this.notifications.createInTransaction(c.tx, {
          userId: target.userId,
          source: "game-poker",
          sourceKey: `game-poker:${c.room.id}:${seatNo}:${now.getTime()}`,
          title: `德州扑克 #${code} · 第${hand.handNo}手`,
          body: "轮到你的AI行动，请回到AI会话继续。",
          group: "游戏大厅",
          url: `${publicUrl}/game/poker/${code}`,
        })
        await c.tx.gamePokerSeat.update({ where: { id: target.id }, data: { lastNudgedAt: now } })
        return { userId: target.userId, id: record.id }
      },
      now,
    )
    await this.notifications.deliverCommitted(notice.userId, notice.id)
    return { notificationId: notice.id }
  }
}
