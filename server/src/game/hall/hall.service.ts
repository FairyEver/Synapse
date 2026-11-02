import { randomUUID } from "node:crypto"
import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma, type GameAccount, type GamePendingTransfer } from "@prisma/client"
import { PrismaService } from "../../prisma/prisma.service"
import { GAME_REGISTRY } from "./game-registry"

export type PendingTransferInput = Pick<GamePendingTransfer, "sourceId" | "gameKind" | "gameRoomId" | "settlementId" | "userId" | "admissionId" | "amount"> & { funding: "points" | "practice" }

/** Trusted service-side participants, never accepted directly from client requests. */
export interface ActiveGameAdmission {
  admissionId: string
  userId: string
  gameKind: string
  gameRoomId: string
  funding: "points" | "practice"
}

type JoinSession = {
  admissionId?: string
  gameKind: string
  gameRoomId: string
  roomCode: string
  seatNo: number
  buyIn: number
  funding?: "points" | "practice"
  startCursor?: string
}
@Injectable()
export class HallService {
  constructor(private readonly prisma: PrismaService) {}

  async lockAccount(tx: Prisma.TransactionClient, userId: string): Promise<GameAccount> {
    await tx.$executeRaw`
      INSERT INTO "GameAccount" ("userId", "updatedAt")
      VALUES (${userId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT ("userId") DO NOTHING`
    const [account] = await tx.$queryRaw<
      GameAccount[]
    >`SELECT "userId", "points", "netProfit", "lastGrantAt", "updatedAt" FROM "GameAccount" WHERE "userId" = ${userId} FOR UPDATE`
    return account
  }

  /** Acquire all points accounts before any game/session financial writes. */
  async lockAccounts(tx: Prisma.TransactionClient, userIds: readonly string[]): Promise<GameAccount[]> {
    const accounts: GameAccount[] = []
    for (const userId of [...new Set(userIds)].sort()) accounts.push(await this.lockAccount(tx, userId))
    return accounts
  }

  async freezeTransfers(tx: Prisma.TransactionClient, records: readonly PendingTransferInput[], now: Date): Promise<void> {
    if (records.length > 10 || records.some(r => !Number.isInteger(r.amount) || r.amount <= 0 || r.amount > 2147483647 || !["points", "practice"].includes(r.funding) || !r.sourceId || !r.settlementId || !r.admissionId || !r.userId || !r.gameKind || !r.gameRoomId))
      throw new BadRequestException("冻结资产必须为正整数，每批至多十个收款入座。")
    await this.lockAccounts(tx, records.filter(r => r.funding === "points").map(r => r.userId))
    for (const record of records) {
      // A unique conflict waits for the original transaction; never overwrite a prior intent.
      await tx.gamePendingTransfer.createMany({ data: [{ ...record, createdAt: now }], skipDuplicates: true })
      const stored = await tx.gamePendingTransfer.findUniqueOrThrow({ where: { sourceId_admissionId: { sourceId: record.sourceId, admissionId: record.admissionId } } })
      if (Object.keys(record).some(key => stored[key as keyof PendingTransferInput] !== record[key as keyof PendingTransferInput]))
        throw new BadRequestException("冻结资产请求与原记录不一致。")
    }
  }

  async releaseTransfers(tx: Prisma.TransactionClient, settlementId: string, activeAdmissions: readonly ActiveGameAdmission[], now: Date): Promise<GamePendingTransfer[]> {
    const where = { settlementId, status: "pending" }
    const users = await tx.gamePendingTransfer.groupBy({ by: ["userId"], where: { ...where, funding: "points" } })
    await this.lockAccounts(tx, users.map(r => r.userId))
    const released: GamePendingTransfer[] = []
    for (;;) {
      const page = await tx.gamePendingTransfer.findMany({ where, orderBy: { id: "asc" }, take: 100 })
      if (!page.length) break
      for (const transfer of page) {
        const active = activeAdmissions.some(a => a.admissionId === transfer.admissionId && a.userId === transfer.userId && a.gameKind === transfer.gameKind && a.gameRoomId === transfer.gameRoomId && a.funding === transfer.funding)
        const session = active && transfer.funding === "points" ? await tx.gameSession.findFirst({ where: {
          userId: transfer.userId, gameKind: transfer.gameKind, gameRoomId: transfer.gameRoomId,
          admissionId: transfer.admissionId, funding: transfer.funding, status: { not: "closed" },
        } }) : null
        const releasedTo = session || (active && transfer.funding === "practice") ? "table" : transfer.funding === "points" ? "account" : "discard"
        // CAS also prevents duplicate practice release (which has no account lock).
        const data = { status: releasedTo === "discard" ? "voided" : "released", releasedTo, releasedAt: now }
        const changed = await tx.gamePendingTransfer.updateMany({ where: { id: transfer.id, status: "pending" }, data })
        if (!changed.count) continue
        if (releasedTo === "account") await tx.gameAccount.update({ where: { userId: transfer.userId }, data: {
          points: { increment: transfer.amount }, netProfit: { increment: transfer.amount },
        } })
        // Table projection already includes engine credits; do not increment session.inPlay again.
        released.push({ ...transfer, ...data })
      }
    }
    return released
  }

  async voidTransfers(tx: Prisma.TransactionClient, settlementId: string, now: Date): Promise<void> {
    // Cancellation only destroys practice chips; confirmed points must be released to their owner.
    if (await tx.gamePendingTransfer.count({ where: { settlementId, funding: "points", status: "pending" } }))
      throw new BadRequestException("已确权点数不能作废，必须结算释放。")
    await tx.gamePendingTransfer.updateMany({ where: { settlementId, funding: "practice", status: "pending" }, data: { status: "voided", releasedTo: "discard", releasedAt: now } })
  }

  async join(tx: Prisma.TransactionClient, userId: string, input: JoinSession, now: Date) {
    const funding = input.funding ?? "points"
    if (!Number.isSafeInteger(input.buyIn) || (funding === "practice" ? input.buyIn !== 0 : input.buyIn <= 0))
      throw new BadRequestException("带入额必须为正整数。")
    const account = funding === "points" ? await this.lockAccount(tx, userId) : null
    const where = {
      userId_gameKind_gameRoomId: {
        userId,
        gameKind: input.gameKind,
        gameRoomId: input.gameRoomId,
      },
    }
    const existing = await tx.gameSession.findUnique({ where })
    if (existing && existing.status !== "closed")
      throw new BadRequestException({ code: "POKER_ALREADY_SEATED", message: "已在该房间入座。" })
    if (account && account.points < input.buyIn)
      throw new BadRequestException({
        code: "POKER_INSUFFICIENT_BALANCE",
        message: "可用点数不足。",
      })
    if (account) await tx.gameAccount.update({
      where: { userId },
      data: { points: { increment: -input.buyIn } },
    })
    const data = {
      admissionId: input.admissionId ?? randomUUID(),
      funding,
      roomCode: input.roomCode,
      seatNo: input.seatNo,
      buyIn: input.buyIn,
      inPlay: input.buyIn,
      returned: null,
      status: "waiting",
      needsAction: false,
      deadlineAt: null,
      lastActiveAt: now,
      startedAt: now,
      startCursor: input.startCursor ?? null,
    }
    return tx.gameSession.upsert({
      where,
      create: { userId, gameKind: input.gameKind, gameRoomId: input.gameRoomId, ...data },
      update: data,
    })
  }

  async leave(
    tx: Prisma.TransactionClient,
    userId: string,
    gameKind: string,
    gameRoomId: string,
    refund: number,
    now: Date,
  ) {
    if (!Number.isSafeInteger(refund) || refund < 0)
      throw new BadRequestException("退款必须为非负整数。")
    const where = { userId_gameKind_gameRoomId: { userId, gameKind, gameRoomId } }
    let session = await tx.gameSession.findUnique({ where })
    if (!session || session.status === "closed") return
    if (session.funding === "practice" && refund !== 0)
      throw new BadRequestException("练习筹码不能退入点数账户。")
    if (session.funding !== "practice") {
      await this.lockAccount(tx, userId)
      // A concurrent close may have committed while this transaction waited.
      session = await tx.gameSession.findUnique({ where })
      if (!session || session.status === "closed") return
      await tx.gameAccount.update({
        where: { userId },
        data: { points: { increment: refund }, netProfit: { increment: refund - session.buyIn } },
      })
    }
    await tx.gameSession.update({
      where: { id: session.id },
      data: {
        status: "closed",
        needsAction: false,
        deadlineAt: null,
        inPlay: 0,
        returned: refund,
        lastActiveAt: now,
      },
    })
  }

  async overview(userId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, userId)
      type SessionRow = {
        funding: string
        gameKind: string
        roomCode: string
        seatNo: number
        status: string
        needsAction: boolean
        deadlineAt: string | null
      }
      const [summary] = await tx.$queryRaw<
        { sessions: SessionRow[]; inPlay: number; activeProfit: number; pending: number }[]
      >`
        WITH active AS (
          SELECT * FROM "GameSession" WHERE "userId" = ${userId} AND "status" <> 'closed'
        ), frozen AS (
          SELECT COALESCE(sum("amount"), 0)::float8 AS pending FROM "GamePendingTransfer"
          WHERE "userId" = ${userId} AND "funding" = 'points' AND "status" = 'pending'
        ), provisional AS (
          SELECT COALESCE(sum("remainingAmount"), 0)::float8 AS pending FROM "GameReserveClaim"
          WHERE "userId" = ${userId} AND "funding" = 'points' AND "status" = 'pending'
        )
        SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'gameKind', "gameKind", 'funding', "funding", 'roomCode', "roomCode", 'seatNo', "seatNo",
          'status', "status", 'needsAction', "needsAction", 'deadlineAt', "deadlineAt" AT TIME ZONE 'UTC'
        )) FROM active), '[]'::jsonb) AS sessions,
        COALESCE((SELECT sum("inPlay") FROM active WHERE "funding" = 'points'), 0)::float8 AS "inPlay",
        COALESCE((SELECT sum("inPlay" - "buyIn") FROM active WHERE "funding" = 'points'), 0)::float8 AS "activeProfit",
        ((SELECT pending FROM frozen) + (SELECT pending FROM provisional)) AS pending`
      const sessions = summary.sessions
        .map((s) => ({
          game: s.gameKind,
          funding: s.funding ?? "points",
          gameName: GAME_REGISTRY.find((g) => g.id === s.gameKind)?.name ?? s.gameKind,
          roomCode: s.roomCode,
          seatNo: s.seatNo,
          status: s.status,
          needsAction: s.needsAction,
          deadlineMs: s.deadlineAt
            ? Math.max(0, new Date(s.deadlineAt).getTime() - now.getTime())
            : null,
        }))
        .sort(
          (a, b) =>
            Number(b.needsAction) - Number(a.needsAction) ||
            (a.deadlineMs ?? Infinity) - (b.deadlineMs ?? Infinity),
        )
      const inPlay = summary.inPlay
      return {
        points: {
          total: account.points + inPlay + summary.pending,
          pending: summary.pending,
          available: account.points,
          inPlay,
          netProfit: account.netProfit + summary.activeProfit + summary.pending,
        },
        sessions,
        games: GAME_REGISTRY,
        next: sessions[0] ? { game: sessions[0].game, roomCode: sessions[0].roomCode } : null,
      }
    })
  }

  async grant(userId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, userId)
      const seated = await tx.gameSession.count({ where: { userId, funding: "points", status: { not: "closed" } } })
      const pending = await tx.gamePendingTransfer.count({ where: { userId, funding: "points", status: "pending" } })
      const provisional = await tx.gameReserveClaim.count({ where: { userId, funding: "points", status: "pending", remainingAmount: { gt: 0 } } })
      if (
        pending || provisional ||
        account.points !== 0 ||
        seated ||
        (account.lastGrantAt && now.getTime() - account.lastGrantAt.getTime() < 86400000)
      )
        throw new BadRequestException("补助仅限零余额且无进行中游戏，每24小时一次。")
      return tx.gameAccount.update({
        where: { userId },
        data: { points: { increment: 10000 }, lastGrantAt: now },
      })
    })
  }
}
