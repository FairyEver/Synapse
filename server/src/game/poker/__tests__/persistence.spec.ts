import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import type { PrismaService } from "../../../prisma/prisma.service"

import { gameTestDatabaseUrl } from "./test-database"
const url = gameTestDatabaseUrl()
const suite = url ? describe : describe.skip
suite("真实Postgres房间事务", () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const u1 = randomUUID(),
    u2 = randomUUID()
  const hall = new HallService(prisma)
  const poker = new PokerService(prisma, hall)
  beforeAll(async () => {
    await prisma.$connect()
  })
  afterAll(() => prisma.$disconnect())
  it("并发10次入座同一房间只能扣一次；跨房间余额不足时仅一桌成功", async () => {
    const code = (await poker.createRoom(u1, { maxSeats: 6, buyIn: 1000 })).roomCode
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => poker.join(u1, code, {})),
    )
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1)
    expect((await hall.overview(u1)).points.available).toBe(999000)
    await poker.leave(u1, code)
    expect((await hall.overview(u1)).points.available).toBe(1000000)
    await prisma.gameAccount.update({ where: { userId: u1 }, data: { points: 1000 } })
    const codes = await Promise.all(
      Array.from({ length: 10 }, () => poker.createRoom(u1, { maxSeats: 2, buyIn: 1000 })),
    )
    const joins = await Promise.allSettled(codes.map((c) => poker.join(u1, c.roomCode, {})))
    expect(joins.filter((a) => a.status === "fulfilled")).toHaveLength(1)
    expect((await hall.overview(u1)).points.available).toBe(0)
  })
  it("超过1000个跨游戏会话时overview仍返回全部且点数不截断", async () => {
    const userId = randomUUID()
    await prisma.gameAccount.create({ data: { userId, points: 500 } })
    await prisma.gameSession.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        userId,
        gameKind: "fixture",
        gameRoomId: String(i),
        roomCode: String(i),
        seatNo: 0,
        status: "active",
        buyIn: 1,
        inPlay: 2,
        startedAt: new Date(),
        lastActiveAt: new Date(),
      })),
    })
    const view = await hall.overview(userId)
    expect(view.sessions).toHaveLength(1001)
    expect(view.points).toEqual({ available: 500, inPlay: 2002, total: 2502, netProfit: 1001 })
  })
  it("大厅截止时间按UTC解释数据库timestamp，不受服务器本地时区影响", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      now = new Date("2026-10-30T01:00:00.000Z"),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {}, now)
    await poker.join(b, code, {}, now)
    const previousZone = process.env.TZ
    try {
      process.env.TZ = "Asia/Shanghai"
      const view = await hall.overview(a, now)
      expect(view.sessions[0].deadlineMs).toBe(600000)
    } finally {
      if (previousZone === undefined) delete process.env.TZ
      else process.env.TZ = previousZone
    }
  })
  it("版本历史超过1000项仍完整返回", async () => {
    const user = randomUUID(),
      agent = await poker.upsertAgent(user, { persona: "" })
    await prisma.gamePokerAgentVersion.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        agentId: agent.id,
        versionNo: i + 1,
        persona: String(i),
        contentHash: String(i),
      })),
    })
    const versions = await poker.agentVersions(user, agent.id)
    expect(versions).toHaveLength(1001)
    expect(versions[0].versionNo).toBe(1001)
    expect(versions.at(-1)?.versionNo).toBe(1)
  })
  it("提示词版本按内容生成，空初始无版本，相同不重复，清空也留版本", async () => {
    const agent = await poker.upsertAgent(u2, { model: "deepseek", persona: "" })
    expect(agent.currentVersionId).toBeNull()
    await poker.upsertAgent(u2, { id: agent.id, persona: "松凶" })
    await poker.upsertAgent(u2, { id: agent.id, persona: "松凶" })
    await poker.upsertAgent(u2, { id: agent.id, persona: "紧凶" })
    await poker.upsertAgent(u2, { id: agent.id, persona: "" })
    const versions = await poker.agentVersions(u2, agent.id)
    expect(versions.map((v) => v.versionNo)).toEqual([3, 2, 1])
    await expect(poker.agentVersions("stranger", agent.id)).rejects.toThrow()
  })
})

suite("数据库硬约束", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  })
  afterAll(() => db.$disconnect())
  it("同房间账号唯一约束拒绝绕过service的重复座位", async () => {
    const roomId = randomUUID(),
      userId = randomUUID()
    await db.gamePokerSeat.create({
      data: { roomId, userId, seatNo: 0, displayName: "测试", stack: 1, lastSeenAt: new Date() },
    })
    await expect(
      db.gamePokerSeat.create({
        data: { roomId, userId, seatNo: 1, displayName: "测试", stack: 1, lastSeenAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })
})
