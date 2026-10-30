import { Injectable, Logger } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import type { Prisma } from "@prisma/client"
import { PokerActionService } from "./poker-action.service"
type RoomCursor = { at: Date; id: string; maintainedAt?: Date | null }
type Rotation = { cutoff: Date | null; cursor: RoomCursor | null }
@Injectable()
export class PokerDeadlineTask {
  private running = false
  private lastMaintenance = 0
  private readonly deadlines: Rotation = { cutoff: null, cursor: null }
  private readonly idleRooms: Rotation = { cutoff: null, cursor: null }
  private readonly logger = new Logger(PokerDeadlineTask.name)
  constructor(private readonly actions: PokerActionService) {}
  private afterRoom(kind: "deadline" | "idle", cursor: RoomCursor): Prisma.GamePokerRoomWhereInput {
    const field = kind === "deadline" ? "actionDeadlineAt" : "createdAt"
    const after = [{ [field]: { gt: cursor.at } }, { [field]: cursor.at, id: { gt: cursor.id } }]
    if (kind === "deadline") return { OR: after }
    return cursor.maintainedAt == null
      ? { OR: [{ lastMaintainedAt: null, OR: after }, { lastMaintainedAt: { not: null } }] }
      : {
          OR: [
            { lastMaintainedAt: { gt: cursor.maintainedAt } },
            { lastMaintainedAt: cursor.maintainedAt, OR: after },
          ],
        }
  }
  private async roomBatch(kind: "deadline" | "idle", cutoff: Date) {
    const rotation = kind === "deadline" ? this.deadlines : this.idleRooms
    const field = kind === "deadline" ? "actionDeadlineAt" : "createdAt"
    rotation.cutoff ??= cutoff
    // Freeze a pass so newly eligible rooms cannot indefinitely delay its wrap.
    const read = () =>
      this.actions.poker.prisma.gamePokerRoom.findMany({
        where: {
          status: kind === "deadline" ? "running" : { in: ["waiting", "paused"] },
          [field]: { lte: new Date(Math.min(cutoff.getTime(), rotation.cutoff!.getTime())) },
          AND: [
            // Successful maintenance moves its sort key. Exclude those rows for
            // the rest of this pass, while retaining NULL-first priority.
            ...(kind === "idle"
              ? [
                  {
                    OR: [
                      { lastMaintainedAt: null },
                      { lastMaintainedAt: { lt: new Date(rotation.cutoff!.getTime() + 1800000) } },
                    ],
                  },
                ]
              : []),
            ...(rotation.cursor ? [this.afterRoom(kind, rotation.cursor)] : []),
          ],
        },
        select: {
          id: true,
          code: true,
          actionDeadlineAt: true,
          createdAt: true,
          lastMaintainedAt: true,
        },
        take: 100,
        orderBy:
          kind === "idle"
            ? [
                { lastMaintainedAt: { sort: "asc", nulls: "first" } },
                { createdAt: "asc" },
                { id: "asc" },
              ]
            : [{ actionDeadlineAt: "asc" }, { id: "asc" }],
      })
    let rooms = await read()
    if (!rooms.length && rotation.cursor) {
      rotation.cursor = null
      rotation.cutoff = cutoff
      rooms = await read()
    }
    return rooms
  }
  @Interval(1000)
  async scan(now = new Date()): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const rooms = await this.roomBatch("deadline", now)
      for (const room of rooms) {
        try {
          await this.actions.expire(room.code, now)
        } catch (error) {
          this.logger.warn(
            { roomCode: room.code, errorName: error instanceof Error ? error.name : "Unknown" },
            "Poker deadline transition failed",
          )
        } finally {
          this.deadlines.cursor = { at: room.actionDeadlineAt!, id: room.id }
        }
      }
      if (rooms.length < 100) this.deadlines.cutoff = this.deadlines.cursor = null
      if (now.getTime() - this.lastMaintenance >= 30000) {
        this.lastMaintenance = now.getTime()
        const idle = await this.roomBatch("idle", new Date(now.getTime() - 1800000))
        for (const room of idle)
          try {
            await this.actions.poker.maintain(room.code, now)
          } catch (error) {
            this.logger.warn(
              { roomCode: room.code, errorName: error instanceof Error ? error.name : "Unknown" },
              "Poker room maintenance failed",
            )
          } finally {
            this.idleRooms.cursor = {
              at: room.createdAt,
              id: room.id,
              maintainedAt: room.lastMaintainedAt,
            }
          }
        if (idle.length < 100) this.idleRooms.cutoff = this.idleRooms.cursor = null
      }
    } finally {
      this.running = false
    }
  }
}
