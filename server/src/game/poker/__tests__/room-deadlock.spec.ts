import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it, vi } from "vitest"
import { Prisma, PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { gameTestDatabaseUrl } from "./test-database"

// Isolate shuffle entropy: the new big blind has aces, and the old one-chip
// small blind loses. Room-code entropy and action identifiers remain real.
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>(),
    deck = [..."23456789TJQKA"].flatMap((rank) => [..."shdc"].map((suit) => rank + suit)),
    prefix = ["As", "Kc", "Ah", "Qd", "2c", "2h", "3d", "7c", "3c", "8s", "4c", "9h"],
    target = [...prefix, ...deck.filter((card) => !prefix.includes(card))],
    swaps = new Map<number, number>()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.indexOf(target[i])
    swaps.set(i + 1, j)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return {
    ...original,
    randomInt: (min: number, max?: number) =>
      max === undefined ? swaps.get(min)! : original.randomInt(min, max),
  }
})

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("跨房间资金事务死锁", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall)
  afterAll(() => db.$disconnect())

  it("两房互换入座遇到自动结算退款的账号锁死锁后仍各成功一次且守恒", async () => {
    const a = randomUUID(),
      b = randomUUID(),
      r1 = (await poker.createRoom(b, { maxSeats: 2, buyIn: 1000 })).roomCode,
      r2 = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, b, r1, {})
    await joinForStartedHand(poker, a, r2, {})
    // These ongoing sessions have previously lost 999 chips elsewhere at their
    // tables. Remaining available balances and session buy-ins are unchanged.
    await db.gamePokerSeat.updateMany({ where: { userId: { in: [a, b] } }, data: { stack: 1 } })
    await db.gameSession.updateMany({ where: { userId: { in: [a, b] } }, data: { inPlay: 1 } })
    const beforeA = (await hall.overview(a)).points,
      beforeB = (await hall.overview(b)).points,
      before = beforeA.total + beforeB.total
    let arrivals = 0,
      release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    class SimultaneousHall extends HallService {
      override async join(...args: Parameters<HallService["join"]>) {
        const session = await super.join(...args)
        if (++arrivals === 2) release()
        await gate
        return session
      }
    }
    const concurrent = new PokerService(db, new SimultaneousHall(db)),
      attempts = await Promise.allSettled([concurrent.join(a, r1, {}), concurrent.join(b, r2, {})])
    expect(attempts, JSON.stringify(attempts)).toEqual([
      { status: "fulfilled", value: { roomCode: r1, seatNo: 1 } },
      { status: "fulfilled", value: { roomCode: r2, seatNo: 1 } },
    ])
    expect(arrivals).toBeGreaterThan(2)
    const seats = await db.gamePokerSeat.findMany({
      where: { userId: { in: [a, b] } },
      orderBy: { userId: "asc" },
    })
    expect(seats).toHaveLength(2)
    expect(seats.every((seat) => seat.seatNo === 1 && seat.stack === 1001)).toBe(true)
    expect(await db.gameSession.count({ where: { userId: { in: [a, b] } } })).toBe(4)
    expect(
      await db.gameSession.count({ where: { userId: { in: [a, b] }, status: "closed" } }),
    ).toBe(2)
    const afterA = (await hall.overview(a)).points,
      afterB = (await hall.overview(b)).points
    expect(afterA.available).toBe(998000)
    expect(afterB.available).toBe(998000)
    expect(afterA.total + afterB.total).toBe(before)
    expect(afterA.netProfit + afterB.netProfit).toBe(beforeA.netProfit + beforeB.netProfit)
    const rooms = await db.gamePokerRoom.findMany({ where: { code: { in: [r1, r2] } } })
    expect(rooms.every((room) => room.handNo === 1 && room.status === "paused")).toBe(true)
  }, 10000)
  it("同账号两桌同时离座只退回各自的筹码一次", async () => {
    const userId = randomUUID(),
      r1 = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode,
      r2 = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, userId, r1, {})
    await joinForStartedHand(poker, userId, r2, {})
    await Promise.all([poker.leave(userId, r1), poker.leave(userId, r2)])
    expect((await hall.overview(userId)).points).toEqual({
      total: 1000000,
      available: 1000000,
      inPlay: 0,
      pending: 0,
      netProfit: 0,
    })
    expect(await db.gameSession.count({ where: { userId, status: "closed" } })).toBe(2)
  })
  it("同账号跨桌入座与离座并发保持可用余额和总额一致", async () => {
    const userId = randomUUID(),
      r1 = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode,
      r2 = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, userId, r1, {})
    await Promise.all([poker.join(userId, r2, {}), poker.leave(userId, r1)])
    expect((await hall.overview(userId)).points).toEqual({
      total: 1000000,
      available: 999000,
      inPlay: 1000,
      pending: 0,
      netProfit: 0,
    })
    expect(await db.gamePokerSeat.count({ where: { userId } })).toBe(1)
  })
  it("持续P2034冲突最多尝试三次，失败事务的写入均回滚", async () => {
    const code = (await poker.createRoom(randomUUID(), { maxSeats: 2, buyIn: 1000 })).roomCode,
      error = new Prisma.PrismaClientKnownRequestError("transaction deadlock", {
        code: "P2034",
        clientVersion: Prisma.prismaVersion.client,
      })
    const originalName = (await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })).name
    let attempts = 0
    await expect(
      poker.withRoom(code, async (c) => {
        attempts++
        await c.tx.gamePokerRoom.update({ where: { id: c.room.id }, data: { name: "不能留下" } })
        throw error
      }),
    ).rejects.toBe(error)
    expect(attempts).toBe(3)
    expect((await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })).name).toBe(originalName)
  })
  it.each([
    new Error("network failed"),
    new Prisma.PrismaClientKnownRequestError("other raw query error", {
      code: "P2010",
      meta: { code: "XX000" },
      clientVersion: Prisma.prismaVersion.client,
    }),
  ])("一般错误不进行隐式重试：%s", async (error) => {
    const code = (await poker.createRoom(randomUUID(), { maxSeats: 2, buyIn: 1000 })).roomCode
    let attempts = 0
    await expect(
      poker.withRoom(code, async () => {
        attempts++
        throw error
      }),
    ).rejects.toBe(error)
    expect(attempts).toBe(1)
  })
  it("提交后的订阅回调异常不重跑已成功的资金事务", async () => {
    const code = (await poker.createRoom(randomUUID(), { maxSeats: 2, buyIn: 1000 })).roomCode,
      error = new Prisma.PrismaClientKnownRequestError("listener error", {
        code: "P2034",
        clientVersion: Prisma.prismaVersion.client,
      })
    let writes = 0,
      notifications = 0
    const unsubscribe = poker.subscribe(() => {
      notifications++
      throw error
    })
    try {
      await expect(
        poker.withRoom(code, async (c) => {
          writes++
          await c.tx.gamePokerRoom.update({ where: { id: c.room.id }, data: { name: "已提交" } })
        }),
      ).rejects.toBe(error)
      expect(writes).toBe(1)
      expect(notifications).toBe(1)
      expect((await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })).name).toBe("已提交")
    } finally {
      unsubscribe()
    }
  })
})
