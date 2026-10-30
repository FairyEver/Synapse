import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from "@nestjs/common"
import { PokerActionService } from "./poker-action.service"
import { reject } from "./poker-error"
const MAX_CURSOR_VALUE = 2147483647
@Injectable()
export class PokerWaitService implements OnModuleDestroy {
  private readonly waiters = new Map<string, Set<() => void>>()
  private readonly active = new Map<string, number>()
  private readonly unsubscribe: () => void
  private stopped = false
  constructor(private readonly actions: PokerActionService) {
    this.unsubscribe = actions.poker.subscribe((code) => {
      for (const wake of this.waiters.get(code) ?? []) wake()
    })
  }
  onModuleDestroy() {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    for (const list of this.waiters.values()) for (const wake of list) wake()
  }
  async wait(
    userId: string,
    code: string,
    cursor = "",
    timeoutMs = 25000,
    signal?: AbortSignal,
    now?: Date,
  ): Promise<Record<string, any>> {
    this.assertWaiting(signal)
    const match = /^(\d+):(\d+)$/.exec(cursor),
      position = match ? ([Number(match[1]), Number(match[2])] as const) : null
    if (
      cursor &&
      (!position || position.some((value) => !Number.isInteger(value) || value > MAX_CURSOR_VALUE))
    )
      reject("POKER_ILLEGAL_ACTION", "游标无效，请从overview重新接回。")
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 25000)
      reject("POKER_ILLEGAL_ACTION", "wait须在0–25000毫秒之间。")
    if ((this.active.get(code) ?? 0) >= 10) reject("POKER_ILLEGAL_ACTION", "该房间等待请求过多。")
    this.active.set(code, (this.active.get(code) ?? 0) + 1)
    const end = Date.now() + timeoutMs
    try {
      do {
        this.assertWaiting(signal)
        const result = await this.read(userId, code, cursor, now ?? new Date(), position)
        this.assertWaiting(signal)
        if (result.status !== "waiting" || Date.now() >= end) return result
        await this.pause(code, Math.min(500, end - Date.now()), signal)
      } while (Date.now() <= end)
      this.assertWaiting(signal)
      return { status: "waiting", cursor }
    } finally {
      const count = (this.active.get(code) ?? 1) - 1
      if (count) this.active.set(code, count)
      else this.active.delete(code)
    }
  }
  private assertWaiting(signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (this.stopped) throw new ServiceUnavailableException("游戏服务正在停止，请稍后重连。")
  }
  private async read(
    userId: string,
    code: string,
    cursor: string,
    now: Date,
    position: readonly [number, number] | null,
  ): Promise<Record<string, any>> {
    return this.actions.poker.withRoom(
      code,
      async (c) => {
        const seat = c.seats.find((s) => s.userId === userId)
        if (seat) {
          await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { lastSeenAt: now } })
          seat.lastSeenAt = now
        }
        const session = await c.tx.gameSession.findUnique({
          where: {
            userId_gameKind_gameRoomId: { userId, gameKind: "poker", gameRoomId: c.room.id },
          },
        })
        // Timeout removal closes the session in the same transaction. Active polling
        // need not expand archived hands; a fresh join also starts a new session epoch.
        const [auto] =
          session?.status === "closed"
            ? await c.tx.$queryRaw<{ id: string; handNo: number; seq: number; action: string }[]>`
            SELECT "id","handNo","seq","action" FROM (
              SELECT action."id",hand."handNo",action."seq",action."action",action."createdAt"
              FROM "GamePokerAction" action JOIN "GamePokerHand" hand ON hand."id"=action."handId"
              WHERE action."roomId"=${c.room.id} AND action."userId"=${userId}
                AND action."isAuto" AND action."createdAt">=${session.startedAt.toISOString()}::timestamp
              UNION ALL
              SELECT action->>'id',archive."handNo",(action->>'seq')::int,action->>'action',(action->>'createdAt')::timestamp
              FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'actions') AS entry(action)
              WHERE archive."roomId"=${c.room.id} AND archive."participantIds" @> ARRAY[${userId}]::text[]
                AND archive."endedAt">=${session.startedAt.toISOString()}::timestamp
                AND action->>'userId'=${userId} AND (action->>'isAuto')::boolean
                AND (action->>'createdAt')::timestamp>=${session.startedAt.toISOString()}::timestamp
            ) events ORDER BY "createdAt" DESC,"id" DESC LIMIT 1`
            : []
        if (auto && session && session.lastEventId !== auto.id) {
          await c.tx.gameSession.update({
            where: { id: session.id },
            data: { lastEventId: auto.id },
          })
          return {
            status: "table_closed",
            cursor: `${auto.handNo}:${auto.seq}`,
            lastAutoAction: { handNo: auto.handNo, action: auto.action, reason: "timeout" },
          }
        }
        if (position && session) {
          const minimum = Math.max(position[0], seat?.joinedHandNo ?? 1),
            includeCurrent = position[1] !== MAX_CURSOR_VALUE,
            epoch = session.startedAt.toISOString()
          // Departure and archival must not discard a result already earned in this
          // session. Compare hand numbers without incrementing the int32 sentinel.
          const [summary] = await c.tx.$queryRaw<
            { handNo: number; result: string; delta: number; stack: number }[]
          >`
            SELECT "handNo","result","delta","stack" FROM (
              SELECT summary."handNo",summary."result",summary."delta",participant."endingStack" AS stack
              FROM "GamePokerHandSummary" summary JOIN "GamePokerHand" hand ON hand."id"=summary."handId"
              JOIN "GamePokerHandSeat" participant ON participant."handId"=hand."id" AND participant."seatNo"=summary."seatNo"
              WHERE summary."userId"=${userId} AND participant."userId"=${userId} AND summary."roomId"=${c.room.id}
                AND hand."status"='settled' AND hand."startedAt">=${epoch}::timestamp
                AND summary."handNo">=${minimum} AND (${includeCurrent} OR summary."handNo">${position[0]})
              UNION ALL
              SELECT archive."handNo",summary->>'result',(summary->>'delta')::int,(participant->>'endingStack')::int
              FROM "GamePokerHandArchive" archive
              CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'summaries') AS summaries(summary)
              CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'seats') AS participants(participant)
              WHERE archive."roomId"=${c.room.id} AND archive."participantIds" @> ARRAY[${userId}]::text[]
                AND summary->>'userId'=${userId} AND participant->>'userId'=${userId}
                AND participant->>'seatNo'=summary->>'seatNo'
                AND (archive."data"->'hand'->>'startedAt')::timestamp>=${epoch}::timestamp
                AND archive."handNo">=${minimum} AND (${includeCurrent} OR archive."handNo">${position[0]})
            ) results ORDER BY "handNo" ASC LIMIT 1`
          if (summary) {
            return {
              status: "hand_result",
              handNo: summary.handNo,
              result: summary.result,
              delta: summary.delta,
              stack: summary.stack,
              cursor: `${summary.handNo}:${MAX_CURSOR_VALUE}`,
            }
          }
        }
        if (!seat || c.room.status === "closed") return { status: "table_closed", cursor }
        const view = await this.actions.view(c, userId, "owner", false)
        if (view.actionOnSeat === view.mySeatNo && view.mySeatNo !== null)
          return {
            status: "your_turn",
            handId: view.handId,
            handNo: view.handNo,
            street: view.street,
            board: view.board,
            hole: view.hole,
            pot: view.pot,
            toCall: view.toCall,
            minRaiseTo: view.minRaiseTo,
            maxRaiseTo: view.maxRaiseTo,
            streetBets: Object.fromEntries(view.seats.map((s) => [s.seatNo, s.streetBet])),
            seats: view.seats,
            recentActions: view.recentActions,
            persona: view.persona,
            legalActions: view.legalActions,
            deadlineMs: view.deadlineMs,
            cursor: view.cursor,
          }
        const current = view.cursor.split(":").map(Number),
          previous = position ?? [0, 0]
        return {
          status: "waiting",
          cursor:
            previous[0] > current[0] || (previous[0] === current[0] && previous[1] > current[1])
              ? cursor
              : view.cursor,
        }
      },
      now,
      false,
    )
  }
  private pause(code: string, ms: number, signal?: AbortSignal): Promise<void> {
    this.assertWaiting(signal)
    return new Promise((resolve, rejectPromise) => {
      const list = this.waiters.get(code) ?? new Set()
      this.waiters.set(code, list)
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        list.delete(finish)
        if (!list.size) this.waiters.delete(code)
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const abort = () => {
        cleanup()
        rejectPromise(signal?.reason ?? new Error("等待已取消"))
      }
      const timer = setTimeout(finish, ms)
      list.add(finish)
      signal?.addEventListener("abort", abort, { once: true })
    })
  }
}
