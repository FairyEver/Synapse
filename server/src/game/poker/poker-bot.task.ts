import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import { PokerActionService } from "./poker-action.service"

@Injectable()
export class PokerBotTask {
  private readonly logger = new Logger(PokerBotTask.name)
  private running = false
  private cutoff: Date | null = null
  private cursor: { id: string; at: Date } | null = null
  constructor(private readonly actions: PokerActionService) {}
  @Interval(1000)
  async scan(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      this.cutoff ??= now
      const read = () => this.actions.poker.prisma.gamePokerRoom.findMany({
        where: { mode: "practice", status: "running", botActionAt: { lte: new Date(Math.min(now.getTime(), this.cutoff!.getTime())) },
          ...(this.cursor ? { OR: [{ botActionAt: { gt: this.cursor.at } }, { botActionAt: this.cursor.at, id: { gt: this.cursor.id } }] } : {}),
        },
        select: { id: true, code: true, botActionAt: true, currentHandId: true, chipRulesVersion: true },
        orderBy: [{ botActionAt: "asc" }, { id: "asc" }], take: 100,
      })
      let rooms = await read()
      if (!rooms.length && this.cursor) { this.cutoff = now; this.cursor = null; rooms = await read() }
      for (const room of rooms) {
        try {
          if (room.currentHandId) await this.actions.actBot(room.code, { handId: room.currentHandId, scheduledAt: room.botActionAt! }, room.chipRulesVersion === "chips-v2" ? undefined : now)
        } catch (error) {
          this.logger.warn({ roomCode: room.code, errorName: error instanceof Error ? error.name : "Unknown" }, "Poker bot transition failed")
        } finally { this.cursor = { id: room.id, at: room.botActionAt! } }
      }
      if (rooms.length < 100) { this.cutoff = null; this.cursor = null }
    } finally { this.running = false }
  }
}
