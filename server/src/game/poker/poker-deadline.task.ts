import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import { PokerActionService } from "./poker-action.service"
@Injectable()
export class PokerDeadlineTask {
  private running = false
  private lastMaintenance = 0
  private readonly logger = new Logger(PokerDeadlineTask.name)
  constructor(private readonly actions: PokerActionService) {}
  @Interval(1000)
  async scan(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const rooms = await this.actions.poker.prisma.gamePokerRoom.findMany({
        where: { status: "running", actionDeadlineAt: { lte: now } },
        select: { code: true },
        take: 100,
        orderBy: { actionDeadlineAt: "asc" },
      })
      for (const room of rooms) {
        try {
          await this.actions.expire(room.code, now)
        } catch (error) {
          this.logger.warn(
            { roomCode: room.code, errorName: error instanceof Error ? error.name : "Unknown" },
            "Poker deadline transition failed",
          )
        }
      }
      if (now.getTime() - this.lastMaintenance >= 30000) {
        this.lastMaintenance = now.getTime()
        const idle = await this.actions.poker.prisma.gamePokerRoom.findMany({
          where: {
            status: { in: ["waiting", "paused"] },
            createdAt: { lte: new Date(now.getTime() - 1800000) },
          },
          select: { code: true },
          orderBy: [{ lastMaintainedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
          take: 100,
        })
        for (const room of idle)
          try {
            await this.actions.poker.maintain(room.code, now)
          } catch (error) {
            this.logger.warn(
              { roomCode: room.code, errorName: error instanceof Error ? error.name : "Unknown" },
              "Poker room maintenance failed",
            )
          }
      }
    } finally {
      this.running = false
    }
  }
}
