import { Injectable } from "@nestjs/common"
import { Prisma, type GamePokerRoom, type GamePokerSeat } from "@prisma/client"
import { createHash, randomInt, randomUUID } from "node:crypto"
import { PrismaService } from "../../prisma/prisma.service"
import { HallService } from "../hall/hall.service"
import { startNext } from "./poker-lifecycle"
import { reject } from "./poker-error"

export type RoomContext = {
  tx: Prisma.TransactionClient
  room: GamePokerRoom
  seats: GamePokerSeat[]
  now: Date
}
export const json = (value: unknown) => value as Prisma.InputJsonValue
function creationIdentity(userId: string, kind: "room" | "agent", creationId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creationId))
    reject("POKER_ILLEGAL_ACTION", "创建标识须为UUID。")
  return `game-${kind}-${createHash("sha256")
    .update(JSON.stringify([userId, creationId.toLowerCase()]))
    .digest("hex")}`
}
@Injectable()
export class PokerService {
  constructor(
    readonly prisma: PrismaService,
    readonly hall: HallService,
  ) {}
  private readonly listeners = new Set<(code: string) => void>()
  subscribe(listener: (code: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  async withRoom<T>(
    code: string,
    work: (context: RoomContext) => Promise<T>,
    now = new Date(),
    changed = true,
  ): Promise<T> {
    let result: T
    for (let attempt = 1; ; attempt++) {
      try {
        result = await this.prisma.$transaction(
          async (tx) => {
            const [room] = await tx.$queryRaw<
              GamePokerRoom[]
            >`SELECT "id", "code", "name", "ownerUserId", "maxSeats", "buyIn", "smallBlind", "bigBlind", "status", "handNo", "dealerSeat", "currentHandId", "actionDeadlineAt", "closeRequested", "lastMaintainedAt", "createdAt", "closedAt" FROM "GamePokerRoom" WHERE "code" = ${code} FOR UPDATE`
            if (!room) reject("POKER_ROOM_NOT_FOUND", "房间不存在。")
            const seats = await tx.gamePokerSeat.findMany({
              where: { roomId: room.id },
              take: 10,
              orderBy: { seatNo: "asc" },
            })
            return work({ tx, room, seats, now })
          },
          { timeout: 15000, maxWait: 15000 },
        )
        break
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40P01"))
        // These errors confirm rollback; allow at most three whole-transaction
        // attempts. Never include committed notifications or unrelated failures here.
        if (!retryable || attempt >= 3) throw error
      }
    }
    if (changed) for (const listener of this.listeners) listener(code)
    return result
  }
  async createRoom(
    userId: string,
    input: { maxSeats: number; buyIn: number; name?: string; creationId?: string },
  ) {
    if (
      !Number.isInteger(input.maxSeats) ||
      input.maxSeats < 2 ||
      input.maxSeats > 10 ||
      ![500, 1000, 2000, 5000].includes(input.buyIn)
    )
      reject("POKER_ILLEGAL_ACTION", "座位应为2–10，带入额仅支持500/1000/2000/5000。")
    const id =
      input.creationId === undefined
        ? undefined
        : creationIdentity(userId, "room", input.creationId)
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const room = await this.prisma.gamePokerRoom.create({
          data: {
            ...(id ? { id } : {}),
            ownerUserId: userId,
            code: String(randomInt(1000, 1000000)),
            maxSeats: input.maxSeats,
            buyIn: input.buyIn,
            name: input.name?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 48),
          },
        })
        return { roomCode: room.code }
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
          throw error
        if (id) {
          const existing = await this.prisma.gamePokerRoom.findFirst({
            where: { id, ownerUserId: userId },
            select: { code: true },
          })
          if (existing) return { roomCode: existing.code }
        }
      }
    }
    reject("POKER_ROOM_FULL", "生成房间号失败，请重试。")
  }
  async join(
    userId: string,
    code: string,
    input: { agentId?: string; modelName?: string },
    now = new Date(),
  ) {
    return this.withRoom(
      code,
      async (c) => {
        const { tx, room, seats } = c
        if (room.status === "closed") reject("POKER_ROOM_CLOSED", "房间已解散。")
        if (seats.some((s) => s.userId === userId))
          reject("POKER_ALREADY_SEATED", "已在该房间入座。")
        if (seats.length >= room.maxSeats) reject("POKER_ROOM_FULL", "房间已满。")
        const agent = input.agentId
          ? await tx.gamePokerAgent.findFirst({ where: { id: input.agentId, userId } })
          : null
        if (input.agentId && !agent) reject("POKER_SEAT_NOT_FOUND", "选手不存在或不属于你。")
        const user = await tx.user.findUnique({ where: { id: userId }, select: { nickname: true } })
        const modelName = (input.modelName ?? agent?.model ?? "")
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 24)
        const seatNo = Array.from({ length: room.maxSeats }, (_, i) => i).find(
          (n) => !seats.some((s) => s.seatNo === n),
        )!
        await this.hall.join(
          tx,
          userId,
          { gameKind: "poker", gameRoomId: room.id, roomCode: code, seatNo, buyIn: room.buyIn },
          now,
        )
        const seat = await tx.gamePokerSeat.create({
          data: {
            roomId: room.id,
            userId,
            seatNo,
            agentId: agent?.id,
            modelName: modelName || null,
            displayName: (user?.nickname ?? "选手") + (modelName ? "的" + modelName : ""),
            stack: room.buyIn,
            lastSeenAt: now,
            joinedHandNo: room.handNo + 1,
          },
        })
        c.seats.push(seat)
        await startNext(this, c)
        return { roomCode: code, seatNo: seat.seatNo }
      },
      now,
    )
  }
  async leave(userId: string, code: string, now = new Date()) {
    return this.withRoom(
      code,
      async (c) => {
        const seat = c.seats.find((s) => s.userId === userId)
        if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        if (c.room.status === "running" && ["active", "folded", "allin"].includes(seat.status)) {
          await c.tx.gamePokerSeat.update({
            where: { id: seat.id },
            data: { leavePending: true, lastSeenAt: now },
          })
          return { pending: true }
        }
        await this.refund(c, seat)
        await startNext(this, c)
        return { pending: false }
      },
      now,
    )
  }
  async refund(c: RoomContext, seat: GamePokerSeat) {
    await this.hall.leave(c.tx, seat.userId, "poker", c.room.id, seat.stack, c.now)
    await c.tx.gamePokerSeat.delete({ where: { id: seat.id } })
    c.seats = c.seats.filter((s) => s.id !== seat.id)
  }
  async sit(userId: string, code: string, sittingOut: boolean, now = new Date()) {
    return this.withRoom(
      code,
      async (c) => {
        const seat = c.seats.find((s) => s.userId === userId)
        if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        const inHand =
          ["active", "folded", "allin"].includes(seat.status) && c.room.status === "running"
        seat.sitPending = sittingOut
        if (!inHand) seat.status = sittingOut ? "sitting_out" : "waiting"
        await c.tx.gamePokerSeat.update({
          where: { id: seat.id },
          data: { sitPending: sittingOut, status: seat.status, lastSeenAt: now },
        })
        await c.tx.gameSession.updateMany({
          where: { userId, gameKind: "poker", gameRoomId: c.room.id, status: { not: "closed" } },
          data: {
            status: ["waiting", "sitting_out"].includes(seat.status) ? seat.status : "active",
            lastActiveAt: now,
            ...(!inHand ? { needsAction: false, deadlineAt: null } : {}),
          },
        })
        await startNext(this, c)
        const current = c.seats.find((s) => s.id === seat.id)
        return {
          sittingOut,
          pending: !!current?.sitPending && current.status !== "sitting_out",
          status: current?.status ?? "left",
        }
      },
      now,
    )
  }
  async close(userId: string, code: string, now = new Date()) {
    return this.withRoom(
      code,
      async (c) => {
        if (c.room.ownerUserId !== userId) reject("POKER_SEAT_NOT_FOUND", "只有房主可以解散房间。")
        if (c.room.status === "running") {
          await c.tx.gamePokerRoom.update({
            where: { id: c.room.id },
            data: { closeRequested: true },
          })
          return { pending: true }
        }
        for (const s of [...c.seats].sort((a, b) => a.userId.localeCompare(b.userId)))
          await this.refund(c, s)
        await c.tx.gamePokerRoom.update({
          where: { id: c.room.id },
          data: { status: "closed", closedAt: now, actionDeadlineAt: null },
        })
        return { closed: true }
      },
      now,
    )
  }
  async maintain(code: string, now = new Date()) {
    return this.withRoom(
      code,
      async (c) => {
        if (!["waiting", "paused"].includes(c.room.status)) return
        await c.tx.gamePokerRoom.update({
          where: { id: c.room.id },
          data: { lastMaintainedAt: now },
        })
        if (c.room.currentHandId) {
          const hand = await c.tx.gamePokerHand.findUnique({
            where: { id: c.room.currentHandId },
            select: { status: true },
          })
          if (hand && hand.status !== "settled") return
        }
        const cutoff = new Date(now.getTime() - 1800000)
        const lastSession = !c.seats.length
          ? await c.tx.gameSession.findFirst({
              where: { gameKind: "poker", gameRoomId: c.room.id },
              orderBy: { lastActiveAt: "desc" },
              select: { lastActiveAt: true },
            })
          : null
        const emptySince = new Date(
          Math.max(c.room.createdAt.getTime(), lastSession?.lastActiveAt.getTime() ?? 0),
        )
        const nobodyOnline = c.seats.length
          ? c.seats.every((s) => s.lastSeenAt <= cutoff)
          : emptySince <= cutoff
        const sessions = await c.tx.gameSession.findMany({
          where: { gameKind: "poker", gameRoomId: c.room.id, status: { not: "closed" } },
          take: 10,
        })
        for (const seat of [...c.seats].sort((a, b) => a.userId.localeCompare(b.userId))) {
          const session = sessions.find((s) => s.userId === seat.userId)
          if (
            nobodyOnline ||
            (seat.status === "sitting_out" && session && session.lastActiveAt <= cutoff)
          )
            await this.refund(c, seat)
        }
        if (nobodyOnline)
          await c.tx.gamePokerRoom.update({
            where: { id: c.room.id },
            data: { status: "closed", closedAt: now, actionDeadlineAt: null },
          })
        else await startNext(this, c)
      },
      now,
    )
  }
  async upsertAgent(
    userId: string,
    input: { id?: string; model?: string; persona?: string; creationId?: string },
  ) {
    if ((input.persona?.length ?? 0) > 20000) reject("POKER_ILLEGAL_ACTION", "风格提示词过长。")
    if (input.id === "") reject("POKER_ILLEGAL_ACTION", "选手ID不能为空。")
    if (input.id !== undefined && input.creationId !== undefined)
      reject("POKER_ILLEGAL_ACTION", "不能同时传选手ID与创建标识。")
    const stableId =
      input.creationId === undefined
        ? undefined
        : creationIdentity(userId, "agent", input.creationId)
    return this.prisma.$transaction(async (tx) => {
      const id = input.id ?? stableId ?? randomUUID()
      if (input.id) {
        const owned = await tx.gamePokerAgent.findFirst({ where: { id, userId } })
        if (!owned) reject("POKER_SEAT_NOT_FOUND", "选手不存在。")
      } else if (stableId) {
        const created = await tx.gamePokerAgent.upsert({
          where: { id },
          update: { id },
          create: { id, userId },
        })
        if (created.userId !== userId) reject("POKER_SEAT_NOT_FOUND", "选手不存在。")
      } else await tx.gamePokerAgent.create({ data: { id, userId } })
      await tx.$queryRaw`SELECT "id" FROM "GamePokerAgent" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`
      const agent = (await tx.gamePokerAgent.findUnique({ where: { id } }))!
      const persona = input.persona ?? agent.persona
      let currentVersionId = agent.currentVersionId,
        versionSeq = agent.versionSeq
      if (persona !== agent.persona) {
        versionSeq++
        const version = await tx.gamePokerAgentVersion.create({
          data: {
            agentId: id,
            versionNo: versionSeq,
            persona,
            contentHash: createHash("sha256").update(persona).digest("hex"),
          },
        })
        currentVersionId = version.id
      }
      return tx.gamePokerAgent.update({
        where: { id },
        data: {
          persona,
          currentVersionId,
          versionSeq,
          model:
            input.model === undefined
              ? agent.model
              : input.model.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 24),
        },
      })
    })
  }
  async agentVersions(userId: string, agentId: string) {
    const owned = await this.prisma.gamePokerAgent.findFirst({
      where: { id: agentId, userId },
      select: { id: true },
    })
    if (!owned) reject("POKER_SEAT_NOT_FOUND", "选手不存在。")
    const rows: {
      id: string
      agentId: string
      versionNo: number
      persona: string
      contentHash: string
      createdAt: Date
    }[] = []
    let beforeVersion: number | undefined
    for (;;) {
      const page = await this.prisma.gamePokerAgentVersion.findMany({
        where: { agentId, ...(beforeVersion ? { versionNo: { lt: beforeVersion } } : {}) },
        orderBy: { versionNo: "desc" },
        take: 1000,
      })
      rows.push(...page)
      if (page.length < 1000) break
      beforeVersion = page.at(-1)!.versionNo
    }
    if (!rows.length) return []
    const usage: { personaVersionId: string; handCount: number; firstUsedAt: Date }[] = []
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const ids = rows.slice(offset, offset + 1000).map((v) => v.id)
      usage.push(
        ...(await this.prisma.$queryRaw<
          { personaVersionId: string; handCount: number; firstUsedAt: Date }[]
        >`
      WITH version_actions AS (
        SELECT "personaVersionId","handId","createdAt" FROM "GamePokerAction" WHERE "userId"=${userId} AND "personaVersionId" IN (${Prisma.join(ids)})
        UNION ALL
        SELECT action->>'personaVersionId',action->>'handId',(action->>'createdAt')::timestamp
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'actions') AS entry(action)
        WHERE archive."participantIds" @> ARRAY[${userId}]::text[] AND action->>'userId'=${userId} AND action->>'personaVersionId' IN (${Prisma.join(ids)})
      ) SELECT "personaVersionId",count(DISTINCT "handId")::int AS "handCount",min("createdAt") AS "firstUsedAt" FROM version_actions GROUP BY "personaVersionId"`),
      )
    }
    return rows.map((v) => ({
      ...v,
      handCount: usage.find((u) => u.personaVersionId === v.id)?.handCount ?? 0,
      firstUsedAt: usage.find((u) => u.personaVersionId === v.id)?.firstUsedAt ?? null,
    }))
  }
}
