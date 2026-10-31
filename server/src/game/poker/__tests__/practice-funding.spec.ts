import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("陪练会话资金隔离", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db)
  afterAll(() => db.$disconnect())
  async function join(userId: string, funding: "points" | "practice") {
    const gameRoomId = randomUUID()
    await db.$transaction((tx) => hall.join(tx, userId, {
      gameKind: "other-game", gameRoomId, roomCode: "1234", seatNo: 0,
      buyIn: funding === "practice" ? 0 : 1000, funding,
    }, new Date()))
    return gameRoomId
  }
  it("陪练建立零记账会话且不创建账户，计分并行时只计算真实占用", async () => {
    const u = randomUUID(), practice = await join(u, "practice")
    expect(await db.gameAccount.findUnique({ where: { userId: u } })).toBeNull()
    expect(await db.gameSession.findFirst({ where: { userId: u } })).toMatchObject({ funding: "practice", buyIn: 0, inPlay: 0 })
    await join(u, "points")
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 999000, inPlay: 1000, netProfit: 0 })
    expect((await hall.overview(u)).sessions.find((s) => s.roomCode === "1234" && s.funding === "practice")).toBeDefined()
    await expect(db.$transaction((tx) => hall.leave(tx, u, "other-game", practice, 500, new Date()))).rejects.toThrow()
    await db.$transaction((tx) => hall.leave(tx, u, "other-game", practice, 0, new Date()))
    expect((await hall.overview(u)).points.available).toBe(999000)
  })
  it("数据库阻止练习会话记入点数或修改资金类型", async () => {
    const u = randomUUID(), id = await join(u, "practice")
    await expect(db.gameSession.updateMany({ where: { userId: u, gameRoomId: id }, data: { inPlay: 1 } })).rejects.toThrow()
    await expect(db.gameSession.updateMany({ where: { userId: u }, data: { funding: "points" } })).rejects.toThrow()
  })
  it("零点数账户的陪练会话不阻止符合条件的补助", async () => {
    const u = randomUUID()
    await join(u, "practice")
    await db.gameAccount.create({ data: { userId: u, points: 0 } })
    await hall.grant(u)
    expect((await hall.overview(u)).points.total).toBe(10000)
    await expect(hall.grant(u)).rejects.toThrow()
  })
  it("两个通用关闭事务重叠时点数只退一次", async () => {
    const u = randomUUID(), roomId = await join(u, "points")
    let arrived = 0, release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    class ConcurrentHall extends HallService {
      override async lockAccount(tx: Parameters<HallService["lockAccount"]>[0], userId: string) {
        if (++arrived <= 2) { if (arrived === 2) release(); await ready }
        return super.lockAccount(tx, userId)
      }
    }
    const concurrent = new ConcurrentHall(db)
    await Promise.all([0, 1].map(() => db.$transaction((tx) => concurrent.leave(tx, u, "other-game", roomId, 1234, new Date()))))
    expect((await hall.overview(u)).points).toEqual({ available: 1000234, total: 1000234, inPlay: 0, netProfit: 234 })
  })
})
