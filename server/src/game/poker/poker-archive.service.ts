import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import {
  type GamePokerAction,
  type GamePokerRoll,
  type GamePokerResolution,
  type GamePokerHand,
  type GamePokerHandSeat,
  type GamePokerHandSummary,
  Prisma,
} from "@prisma/client"
import { PrismaService } from "../../prisma/prisma.service"
import type { CardModeState } from "./engine/cards/pool"
import type { ReserveState } from "./engine/chips/types"
export interface ArchivedHand {
  cards?: CardModeState
  reserve?: ReserveState
  resolutions: GamePokerResolution[]
  hand: Omit<GamePokerHand, "engineState">
  seats: GamePokerHandSeat[]
  actions: GamePokerAction[]
  summaries: GamePokerHandSummary[]
  rolls: GamePokerRoll[]
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
  return { ...data, rolls: Array.isArray(data.rolls) ? data.rolls : [], resolutions: Array.isArray(data.resolutions) ? data.resolutions : [] } as unknown as ArchivedHand
}
@Injectable()
export class PokerArchiveService {
  private readonly logger = new Logger(PokerArchiveService.name)
  private running = false
  private cutoff: Date | null = null
  private cursor: { at: Date; id: string } | null = null
  constructor(private readonly prisma: PrismaService) {}
  async archiveHand(handId: string, now: Date): Promise<boolean> {
    const cutoff = new Date(now.getTime() - 90 * 86400000)
    const [result] = await this.prisma.$queryRaw<
      { archived: boolean }[]
    >`SELECT "game_poker_archive_hand"(${handId},${cutoff.toISOString()}::timestamp) AS "archived"`
    return result.archived
  }
  @Interval(60000)
  async scan(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const cutoff = new Date(now.getTime() - 90 * 86400000)
      this.cutoff ??= cutoff
      // A stable cutoff bounds each pass even while more hands become eligible.
      const read = () =>
        this.prisma.$queryRaw<{ id: string; endedAt: Date }[]>(Prisma.sql`
        SELECT h."id", h."endedAt" FROM "GamePokerHand" h
        JOIN "GamePokerRoom" r ON r."id"=h."roomId"
        WHERE h."status"='settled'
          AND h."endedAt"<=${new Date(Math.min(cutoff.getTime(), this.cutoff!.getTime())).toISOString()}::timestamp
          AND (r."status"<>'running' OR r."currentHandId" IS DISTINCT FROM h."id")
          ${this.cursor ? Prisma.sql`AND (h."endedAt",h."id") > (${this.cursor.at.toISOString()}::timestamp,${this.cursor.id})` : Prisma.empty}
        ORDER BY h."endedAt",h."id" LIMIT 100
      `)
      let rows = await read()
      if (!rows.length && this.cursor) {
        this.cursor = null
        this.cutoff = cutoff
        rows = await read()
      }
      for (const row of rows)
        try {
          await this.archiveHand(row.id, now)
        } catch (error) {
          this.logger.warn(
            { errorName: error instanceof Error ? error.name : "Unknown" },
            "Poker archival failed",
          )
        } finally {
          this.cursor = { at: row.endedAt, id: row.id }
        }
      if (rows.length < 100) this.cutoff = this.cursor = null
    } finally {
      this.running = false
    }
  }
}
