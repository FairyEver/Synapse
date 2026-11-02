import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("空桌从最后离座计时维护", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db))
  afterAll(() => db.$disconnect())
  async function table() {
    const userId = randomUUID(),
      code = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode
    await db.gamePokerRoom.update({ where: { code }, data: { createdAt: new Date(0) } })
    return { userId, code }
  }
  async function state(code: string) {
    return (await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })).status
  }
  it("老房间刚离空仍保留，最后离座满30分钟才关闭", async () => {
    const { userId, code } = await table(),
      leftAt = 7200000
    await joinForStartedHand(poker, userId, code, {}, new Date(0))
    await poker.leave(userId, code, new Date(leftAt))
    await poker.maintain(code, new Date(leftAt + 1))
    expect(await state(code)).not.toBe("closed")
    await poker.maintain(code, new Date(leftAt + 1800000 - 1))
    expect(await state(code)).not.toBe("closed")
    await poker.maintain(code, new Date(leftAt + 1800000))
    expect(await state(code)).toBe("closed")
  })
  it("空桌没有入座历史时从建房时间计算30分钟", async () => {
    const { code } = await table()
    await poker.maintain(code, new Date(1800000 - 1))
    expect(await state(code)).not.toBe("closed")
    await poker.maintain(code, new Date(1800000))
    expect(await state(code)).toBe("closed")
  })
  it("同房间重新入座复用会话后以新一次离座时间计时", async () => {
    const { userId, code } = await table()
    await joinForStartedHand(poker, userId, code, {}, new Date(0))
    const first = await db.gameSession.findFirstOrThrow({ where: { userId, roomCode: code } })
    await poker.leave(userId, code, new Date(3600000))
    await joinForStartedHand(poker, userId, code, {}, new Date(7200000))
    const rejoined = await db.gameSession.findFirstOrThrow({ where: { userId, roomCode: code } })
    expect(rejoined.id).toBe(first.id)
    expect(rejoined.startedAt.getTime()).toBe(7200000)
    expect(rejoined.lastActiveAt.getTime()).toBe(7200000)
    await poker.leave(userId, code, new Date(10800000))
    await poker.maintain(code, new Date(10800001))
    expect(await state(code)).not.toBe("closed")
    await poker.maintain(code, new Date(10800000 + 1800000))
    expect(await state(code)).toBe("closed")
  })
})
