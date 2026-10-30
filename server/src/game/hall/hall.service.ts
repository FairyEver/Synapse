import { BadRequestException, Injectable } from "@nestjs/common"
import { Prisma, type GameAccount } from "@prisma/client"
import { PrismaService } from "../../prisma/prisma.service"
import { GAME_REGISTRY } from "./game-registry"

type JoinSession = {
  gameKind: string
  gameRoomId: string
  roomCode: string
  seatNo: number
  buyIn: number
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

  async join(tx: Prisma.TransactionClient, userId: string, input: JoinSession, now: Date) {
    if (!Number.isSafeInteger(input.buyIn) || input.buyIn <= 0)
      throw new BadRequestException("带入额必须为正整数。")
    const account = await this.lockAccount(tx, userId)
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
    if (account.points < input.buyIn)
      throw new BadRequestException({
        code: "POKER_INSUFFICIENT_BALANCE",
        message: "可用点数不足。",
      })
    await tx.gameAccount.update({
      where: { userId },
      data: { points: { increment: -input.buyIn } },
    })
    const data = {
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
    await this.lockAccount(tx, userId)
    const session = await tx.gameSession.findUnique({
      where: { userId_gameKind_gameRoomId: { userId, gameKind, gameRoomId } },
    })
    if (!session || session.status === "closed") return
    await tx.gameAccount.update({
      where: { userId },
      data: { points: { increment: refund }, netProfit: { increment: refund - session.buyIn } },
    })
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
        gameKind: string
        roomCode: string
        seatNo: number
        status: string
        needsAction: boolean
        deadlineAt: string | null
      }
      const [summary] = await tx.$queryRaw<
        { sessions: SessionRow[]; inPlay: number; activeProfit: number }[]
      >`
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'gameKind', "gameKind", 'roomCode', "roomCode", 'seatNo', "seatNo",
          'status', "status", 'needsAction', "needsAction", 'deadlineAt', "deadlineAt" AT TIME ZONE 'UTC'
        )), '[]'::jsonb) AS sessions,
        COALESCE(sum("inPlay"), 0)::float8 AS "inPlay",
        COALESCE(sum("inPlay" - "buyIn"), 0)::float8 AS "activeProfit"
        FROM "GameSession" WHERE "userId" = ${userId} AND "status" <> 'closed'`
      const sessions = summary.sessions
        .map((s) => ({
          game: s.gameKind,
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
          total: account.points + inPlay,
          available: account.points,
          inPlay,
          netProfit: account.netProfit + summary.activeProfit,
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
      const seated = await tx.gameSession.count({ where: { userId, status: { not: "closed" } } })
      if (
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
