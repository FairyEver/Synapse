import { Injectable } from "@nestjs/common"
import { Prisma, type GamePokerRoom, type GamePokerSeat } from "@prisma/client"
import { createHash, randomInt, randomUUID } from "node:crypto"
import { PrismaService } from "../../prisma/prisma.service"
import { HallService } from "../hall/hall.service"
import { startNext } from "./poker-lifecycle"
import { reject } from "./poker-error"
import { assertController, changeControl, claimControl, type PokerCaller } from "./poker-control"
import { resolveRules, type PokerVariant } from "./engine/rules"
import type { PokerResumeCheckpoint } from "@synapse/shared/game-contracts"

export type RoomContext = {
  tx: Prisma.TransactionClient
  room: GamePokerRoom
  seats: GamePokerSeat[]
  now: Date
}
export const json = (value: unknown) => value as Prisma.InputJsonValue
export function creationIdentity(userId: string, kind: "room" | "agent" | "bot", creationId: string): string {
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
            >`SELECT "id", "code", "name", "ownerUserId", "mode", "variant", "nextHandAt", "botActionAt", "maxSeats", "buyIn", "smallBlind", "bigBlind", "status", "handNo", "dealerSeat", "currentHandId", "actionDeadlineAt", "closeRequested", "lastMaintainedAt", "createdAt", "closedAt" FROM "GamePokerRoom" WHERE "code" = ${code} FOR UPDATE`
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
    input: { maxSeats: number; buyIn: number; name?: string; creationId?: string; mode?: "points" | "practice"; variant?: PokerVariant; blindPreset?: string },
  ) {
    if (
      !Number.isInteger(input.maxSeats) ||
      input.maxSeats < 2 ||
      input.maxSeats > 10 ||
      ![500, 1000, 2000, 5000].includes(input.buyIn) ||
      (input.mode !== undefined && !["points", "practice"].includes(input.mode))
    )
      reject("POKER_ILLEGAL_ACTION", "座位应为2–10，带入额仅支持500/1000/2000/5000。")
    let rules
    try {
      const [smallBlind, bigBlind] = (input.blindPreset ?? "1/2").split("/").map(Number)
      rules = resolveRules({ variant: input.variant, smallBlind, bigBlind })
    } catch {
      reject("POKER_ILLEGAL_ACTION", "请选择有效的牌库和盲注档位。")
    }
    const id =
      input.creationId === undefined
        ? undefined
        : creationIdentity(userId, "room", input.creationId)
    const customName = input.name?.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 48)
    const owner = customName?.trim() ? null : await this.prisma.user.findUnique({
      where: { id: userId }, select: { nickname: true, handle: true },
    })
    const nickname = (owner?.nickname?.trim() || owner?.handle || "用户").replace(/[\x00-\x1f\x7f]/g, "")
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const code = String(randomInt(1000, 1000000))
        const suffix = `的房间 #${code}`
        const room = await this.prisma.gamePokerRoom.create({
          data: {
            ...(id ? { id } : {}),
            ownerUserId: userId,
            mode: input.mode ?? "points",
            ...rules,
            code,
            maxSeats: input.maxSeats,
            buyIn: input.buyIn,
            name: customName?.trim() ? customName : `${nickname.slice(0, 48 - suffix.length)}${suffix}`,
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
    input: { agentId?: string; modelName?: string; controlVersion?: number },
    now = new Date(),
    caller: PokerCaller = "mcp",
  ) {
    return this.withRoom(
      code,
      async (c) => {
        const { tx, room, seats } = c
        if (room.status === "closed") reject("POKER_ROOM_CLOSED", "房间已解散。")
        if (seats.some((s) => s.userId === userId))
          reject("POKER_ALREADY_SEATED", "已在该房间入座。")
        if (seats.length >= room.maxSeats) reject("POKER_ROOM_FULL", "房间已满。")
        const history = await tx.gamePokerControlHistory.findUnique({ where: { roomId_userId: { roomId: room.id, userId } } })
        if (caller === "mcp" && history && (!history.joinPending || input.controlVersion !== history.controlVersion))
          reject("POKER_CONTROL_RELEASED", "请在桌面明确授权AI重新入座，旧循环不能重新扣点。")
        const controlVersion = caller === "human" ? (history ? history.controlVersion + 1 : 0) : history?.controlVersion ?? 0
        if (caller === "human" || history) await tx.gamePokerControlHistory.upsert({
          where: { roomId_userId: { roomId: room.id, userId } },
          create: { roomId: room.id, userId, controlVersion, joinPending: false },
          update: { controlVersion, joinPending: false },
        })
        const agent = caller === "mcp" && input.agentId
          ? await tx.gamePokerAgent.findFirst({ where: { id: input.agentId, userId } })
          : null
        if (caller === "mcp" && input.agentId && !agent) reject("POKER_SEAT_NOT_FOUND", "选手不存在或不属于你。")
        const user = await tx.user.findUnique({ where: { id: userId }, select: { nickname: true } })
        const modelName = (caller === "human" ? "" : input.modelName ?? agent?.model ?? "")
          .replace(/[\x00-\x1f\x7f]/g, "")
          .slice(0, 24)
        const seatNo = Array.from({ length: room.maxSeats }, (_, i) => i).find(
          (n) => !seats.some((s) => s.seatNo === n),
        )!
        await this.hall.join(
          tx,
          userId,
          {
            gameKind: "poker",
            gameRoomId: room.id,
            roomCode: code,
            seatNo,
            buyIn: room.mode === "practice" ? 0 : room.buyIn,
            funding: room.mode === "practice" ? "practice" : "points",
            startCursor: String(room.handNo + 1),
          },
          now,
        )
        const seat = await tx.gamePokerSeat.create({
          data: {
            roomId: room.id,
            userId,
            seatNo,
            controller: caller === "human" ? "human" : "ai",
            controlVersion,
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
  async leave(userId: string, code: string, now = new Date(), caller: PokerCaller = "mcp", controlVersion?: number) {
    return this.withRoom(
      code,
      async (c) => {
        const seat = c.seats.find((s) => s.userId === userId)
        if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        assertController(seat, caller, controlVersion)
        seat.checkpoint = null
        seat.pauseReason = null
        seat.handoffPending = false
        await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { checkpoint: Prisma.DbNull, pauseReason: null, handoffPending: false } })
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
    if (seat.participantKind !== "bot")
      await this.hall.leave(c.tx, seat.userId, "poker", c.room.id, c.room.mode === "practice" ? 0 : seat.stack, c.now)
    await c.tx.gamePokerSeat.delete({ where: { id: seat.id } })
    c.seats = c.seats.filter((s) => s.id !== seat.id)
  }
  async sit(userId: string, code: string, sittingOut: boolean, now = new Date(), caller: PokerCaller = "mcp", controlVersion?: number, reason: "user" | "context_maintenance" = "user") {
    return this.withRoom(
      code,
      async (c) => {
        const seat = c.seats.find((s) => s.userId === userId)
        if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        assertController(seat, caller, controlVersion)
        if (reason === "context_maintenance") {
          if (caller !== "mcp") reject("POKER_ILLEGAL_ACTION", "上下文维护仅用于AI操作。")
          if (seat.leavePending || (seat.pauseReason === "user" && (seat.sitPending || seat.status === "sitting_out")))
            reject("POKER_CONTROL_RELEASED", "用户已暂停或离桌，维护流程不能恢复。")
          if (!sittingOut) {
            const checkpoint = seat.checkpoint as unknown as PokerResumeCheckpoint | null
            if (seat.pauseReason !== reason || !checkpoint?.continueIntent || checkpoint.controlVersion !== seat.controlVersion)
              reject("POKER_CONTROL_RELEASED", "恢复意图已失效，请等待用户操作。")
          }
        }
        const wasSittingOut = seat.status === "sitting_out"
        const inHand =
          ["active", "folded", "allin"].includes(seat.status) && c.room.status === "running"
        seat.sitPending = sittingOut
        if (!inHand) seat.status = sittingOut ? "sitting_out" : "waiting"
        await c.tx.gamePokerSeat.update({
          where: { id: seat.id },
          data: { sitPending: sittingOut, status: seat.status, lastSeenAt: now,
            pauseReason: sittingOut ? reason : null,
            ...(!sittingOut || reason === "user" ? { checkpoint: Prisma.DbNull } : {}),
          },
        })
        await c.tx.gameSession.updateMany({
          where: { userId, gameKind: "poker", gameRoomId: c.room.id, status: { not: "closed" } },
          data: {
            status: ["waiting", "sitting_out"].includes(seat.status) ? seat.status : "active",
            ...(!wasSittingOut || !sittingOut ? { lastActiveAt: now } : {}),
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
  async control(userId: string, code: string, action: "takeover" | "request_ai" | "cancel_ai", controlVersion: number, now = new Date()) {
    return this.withRoom(code, async (c) => {
      const seat = c.seats.find((s) => s.userId === userId && s.participantKind !== "bot")
      if (!seat) {
        if (action === "takeover" || c.room.status === "closed") reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
        const history = await c.tx.gamePokerControlHistory.findUnique({ where: { roomId_userId: { roomId: c.room.id, userId } } })
        if (controlVersion !== (history?.controlVersion ?? 0)) reject("POKER_STALE_CONTROL", "入座授权已变更，请重新读取牌桌。")
        const next = controlVersion + 1, joinPending = action === "request_ai"
        await c.tx.gamePokerControlHistory.upsert({ where: { roomId_userId: { roomId: c.room.id, userId } },
          create: { roomId: c.room.id, userId, controlVersion: next, joinPending }, update: { controlVersion: next, joinPending } })
        return { controller: null, controlVersion: next, handoffPending: joinPending }
      }
      const patch = changeControl(seat, action, controlVersion)
      const updated = await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { ...patch, checkpoint: Prisma.DbNull, lastSeenAt: now } })
      await c.tx.gamePokerControlHistory.upsert({ where: { roomId_userId: { roomId: c.room.id, userId } }, create: { roomId: c.room.id, userId, controlVersion: updated.controlVersion }, update: { controlVersion: updated.controlVersion, joinPending: false } })
      return { controller: updated.controller, controlVersion: updated.controlVersion, handoffPending: updated.handoffPending }
    }, now)
  }
  async claim(userId: string, code: string, controlVersion: number, now = new Date()) {
    return this.withRoom(code, async (c) => {
      const seat = c.seats.find((s) => s.userId === userId && s.participantKind !== "bot")
      if (!seat) reject("POKER_SEAT_NOT_FOUND", "你未在该房间入座。")
      const patch = claimControl(seat, controlVersion)
      const updated = await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { ...patch, checkpoint: Prisma.DbNull, lastSeenAt: now } })
      await c.tx.gamePokerControlHistory.upsert({ where: { roomId_userId: { roomId: c.room.id, userId } }, create: { roomId: c.room.id, userId, controlVersion: updated.controlVersion }, update: { controlVersion: updated.controlVersion, joinPending: false } })
      return { controller: updated.controller, controlVersion: updated.controlVersion, handoffPending: updated.handoffPending }
    }, now)
  }
  async checkpoint(userId: string, code: string, input?: { controlVersion: number; cursor: string; sessionStyle?: string; continueIntent: boolean }, now = new Date()) {
    return this.withRoom(code, async (c) => {
      const seat = c.seats.find((s) => s.userId === userId && s.participantKind !== "bot")
      if (!seat) return input ? reject("POKER_SEAT_NOT_FOUND", "座位已离场，不能保存恢复信息。") : { checkpoint: null }
      if (!input) return { checkpoint: (seat.checkpoint ?? null) as unknown as PokerResumeCheckpoint | null }
      assertController(seat, "mcp", input.controlVersion)
      if (seat.status !== "sitting_out" || seat.pauseReason !== "context_maintenance")
        reject("POKER_ILLEGAL_ACTION", "请先完成本手并确认维护暂离。")
      const parts = /^(\d+):(\d+)$/.exec(input.cursor)
      if (!parts || parts.slice(1).some((v) => Number(v) > 2147483647) || (input.sessionStyle?.length ?? 0) > 20000)
        reject("POKER_ILLEGAL_ACTION", "恢复信息无效。")
      const checkpoint: PokerResumeCheckpoint = { roomCode: code, cursor: input.cursor,
        controlVersion: input.controlVersion, sessionStyle: input.sessionStyle ?? "",
        continueIntent: input.continueIntent, pauseReason: "context_maintenance", savedAt: now.toISOString() }
      await c.tx.gamePokerSeat.update({ where: { id: seat.id }, data: { checkpoint: json(checkpoint) } })
      return { checkpoint }
    }, now, !!input)
  }
  async close(userId: string, code: string, now = new Date()) {
    return this.withRoom(
      code,
      async (c) => {
        if (c.room.ownerUserId !== userId) reject("POKER_SEAT_NOT_FOUND", "只有房主可以解散房间。")
        const soloPractice = c.room.mode === "practice" &&
          c.seats.every((s) => s.participantKind === "bot" || s.userId === userId)
        const hand = soloPractice && c.room.status === "running" && c.room.currentHandId
          ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } })
          : null
        // A departed player may still be owed this hand's result.
        const otherParticipant = hand && hand.status !== "settled"
          ? await c.tx.gamePokerHandSeat.findFirst({
              where: { handId: hand.id, participantKind: { not: "bot" }, userId: { not: userId } },
              select: { id: true },
            })
          : null
        if (c.room.status === "running" && (!soloPractice || otherParticipant)) {
          await c.tx.gamePokerRoom.update({
            where: { id: c.room.id },
            data: { closeRequested: true },
          })
          return { pending: true }
        }
        if (hand && hand.status !== "settled") {
          await c.tx.gamePokerHand.update({
            where: { id: hand.id },
            data: { status: "cancelled", endedAt: now,
              engineState: json({ ...(hand.engineState as Prisma.JsonObject), actionOnSeat: null }) },
          })
        }
        for (const s of [...c.seats].sort((a, b) => a.userId.localeCompare(b.userId)))
          await this.refund(c, s)
        await c.tx.gamePokerRoom.update({
          where: { id: c.room.id },
          data: { status: "closed", closedAt: now, closeRequested: false, actionDeadlineAt: null, botActionAt: null, nextHandAt: null },
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
        const humans = c.seats.filter((s) => s.participantKind !== "bot")
        const lastSession = !humans.length
          ? await c.tx.gameSession.findFirst({
              where: { gameKind: "poker", gameRoomId: c.room.id },
              orderBy: { lastActiveAt: "desc" },
              select: { lastActiveAt: true },
            })
          : null
        const emptySince = new Date(
          Math.max(c.room.createdAt.getTime(), lastSession?.lastActiveAt.getTime() ?? 0),
        )
        const nobodyOnline = humans.length
          ? humans.every((s) => s.lastSeenAt <= cutoff)
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
        SELECT "personaVersionId","handId","createdAt" FROM "GamePokerAction" a WHERE EXISTS (SELECT 1 FROM "GamePokerRoom" r WHERE r."id"=a."roomId" AND r."mode"='points') AND "userId"=${userId} AND "personaVersionId" IN (${Prisma.join(ids)})
        UNION ALL
        SELECT action->>'personaVersionId',action->>'handId',(action->>'createdAt')::timestamp
        FROM "GamePokerHandArchive" archive CROSS JOIN LATERAL jsonb_array_elements(archive."data"->'actions') AS entry(action)
        WHERE EXISTS (SELECT 1 FROM "GamePokerRoom" r WHERE r."id"=archive."roomId" AND r."mode"='points') AND archive."participantIds" @> ARRAY[${userId}]::text[] AND action->>'userId'=${userId} AND action->>'personaVersionId' IN (${Prisma.join(ids)})
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
