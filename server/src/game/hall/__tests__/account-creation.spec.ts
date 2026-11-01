import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient, type Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../hall.service"
import { PokerService } from "../../poker/poker.service"
import { gameTestDatabaseUrl } from "../../poker/__tests__/test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("首次点数账户并发创建", () => {
  const isolatedUrl = new URL(url ?? "postgresql://localhost/unused_e2e")
  isolatedUrl.searchParams.set("connection_limit", "20")
  const db = new PrismaClient({
    datasources: { db: { url: isolatedUrl.toString() } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall)
  afterAll(() => db.$disconnect())

  async function raceCreation(userId: string, jobs: (() => Promise<unknown>)[]) {
    let ready!: (id: string) => void, release!: () => void
    const initialized = new Promise<string>((resolve) => {
        ready = resolve
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve
      })
    class FirstHall extends HallService {
      override async lockAccount(tx: Prisma.TransactionClient, id: string) {
        const account = await super.lockAccount(tx, id),
          [row] = await tx.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`
        ready(row.id)
        await gate
        return account
      }
    }
    // The very first real overview holds its newly inserted account uncommitted.
    // Other requests cannot see it and contend on exactly this account's key.
    const first = new FirstHall(db).overview(userId)
    let requests: Promise<PromiseSettledResult<unknown>[]> | undefined
    try {
      const transactionId = await initialized
      requests = Promise.allSettled(jobs.map((job) => job()))
      const deadline = Date.now() + 2000
      let blocked: { query: string }[] = []
      while (Date.now() < deadline) {
        blocked = await db.$queryRaw<{ query: string }[]>`
          SELECT activity.query FROM pg_locks locks JOIN pg_stat_activity activity ON activity.pid=locks.pid
          WHERE locks.locktype='transactionid' AND NOT locks.granted AND locks.transactionid::text=${transactionId}`
        if (blocked.length === jobs.length) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(blocked).toHaveLength(jobs.length)
      release()
      await first
      const results = await requests
      expect(
        results.filter((result) => result.status === "rejected"),
        JSON.stringify({ results, query: blocked[0]?.query }),
      ).toEqual([])
      return results
    } finally {
      release()
      await Promise.allSettled([first, requests])
    }
  }
  it("新账号第一次同时入十间房不会因账户唯一键冲突失败", async () => {
    const userId = randomUUID(),
      rooms = await Promise.all(
        Array.from({ length: 10 }, () => poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })),
      )
    expect(await db.gameAccount.count({ where: { userId } })).toBe(0)
    await raceCreation(
      userId,
      rooms.map(
        ({ roomCode }) =>
          () =>
            poker.join(userId, roomCode, {}),
      ),
    )
    expect(await db.gameAccount.count({ where: { userId } })).toBe(1)
    expect(await db.gamePokerSeat.count({ where: { userId } })).toBe(10)
    expect(await db.gameSession.count({ where: { userId } })).toBe(10)
    expect((await hall.overview(userId)).points).toEqual({
      total: 1000000,
      available: 990000,
      inPlay: 10000,
      pending: 0,
      netProfit: 0,
    })
  }, 10000)
  it("新账号多窗口首次读取overview全部成功，初始点数只创建一次", async () => {
    const userId = randomUUID()
    expect(await db.gameAccount.count({ where: { userId } })).toBe(0)
    const results = await raceCreation(
      userId,
      Array.from({ length: 10 }, () => () => hall.overview(userId)),
    )
    for (const result of results)
      expect(result).toMatchObject({
        status: "fulfilled",
        value: { points: { total: 1000000, available: 1000000, inPlay: 0 } },
      })
    expect(await db.gameAccount.count({ where: { userId } })).toBe(1)
  }, 10000)
  it("已有账户并发初始化不会重置余额、盈亏或补助时间", async () => {
    const userId = randomUUID(),
      lastGrantAt = new Date(123456789)
    await db.gameAccount.create({ data: { userId, points: 123, netProfit: -999877, lastGrantAt } })
    await Promise.all(Array.from({ length: 10 }, () => hall.overview(userId)))
    expect(await db.gameAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({
      points: 123,
      netProfit: -999877,
      lastGrantAt,
    })
  })
})
