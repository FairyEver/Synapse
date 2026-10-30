import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import type {
  GamePokerAction,
  GamePokerHand,
  GamePokerHandSeat,
  GamePokerHandSummary,
  Prisma,
} from "@prisma/client"
import { PrismaService } from "../../prisma/prisma.service"
export interface ArchivedHand {
  hand: Omit<GamePokerHand, "engineState">
  seats: GamePokerHandSeat[]
  actions: GamePokerAction[]
  summaries: GamePokerHandSummary[]
}
export function archiveData(data: Prisma.JsonValue): ArchivedHand {
  if (
    !data ||
    Array.isArray(data) ||
    typeof data !== "object" ||
    !data.hand ||
    !Array.isArray(data.seats) ||
    !Array.isArray(data.actions) ||
    !Array.isArray(data.summaries)
  )
    throw new Error("归档手牌数据无效。")
  return data as unknown as ArchivedHand
}
@Injectable()
export class PokerArchiveService {
  private readonly logger = new Logger(PokerArchiveService.name)
  private running = false
  constructor(private readonly prisma: PrismaService) {}
  async archiveHand(handId: string, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - 90 * 86400000)
    const [result] = await this.prisma.$queryRaw<
      { archived: boolean }[]
    >`SELECT "game_poker_archive_hand"(${handId},${cutoff}::timestamp) AS "archived"`
    return result.archived
  }
  @Interval(60000)
  async scan(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const cutoff = new Date(now.getTime() - 90 * 86400000)
      const rows = await this.prisma.$queryRaw<
        { id: string }[]
      >`SELECT h."id" FROM "GamePokerHand" h JOIN "GamePokerRoom" r ON r."id"=h."roomId" WHERE h."status"='settled' AND h."endedAt"<=${cutoff} AND (r."status"<>'running' OR r."currentHandId" IS DISTINCT FROM h."id") ORDER BY h."endedAt",h."id" LIMIT 100`
      for (const row of rows)
        try {
          await this.archiveHand(row.id, now)
        } catch (error) {
          this.logger.warn(
            { errorName: error instanceof Error ? error.name : "Unknown" },
            "Poker archival failed",
          )
        }
    } finally {
      this.running = false
    }
  }
}
