import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { PokerArchiveService } from "../poker-archive.service"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand } from "./advance-next-hand"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("延迟请求与自动事件的入座边界", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker),
    wait = new PokerWaitService(actions),
    archive = new PokerArchiveService(db)
  afterAll(() => {
    wait.onModuleDestroy()
    return db.$disconnect()
  })
  async function table() {
    const a = randomUUID(),
      b = randomUUID(),
      base = Date.now() - 91 * 86400000,
      code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000 })).roomCode,
      at = (seconds: number) => new Date(base + seconds * 1000)
    await poker.join(a, code, {}, at(0))
    await poker.join(b, code, {}, at(0))
    const handId = (await actions.state(a, code)).handId!
    return { a, b, code, at, handId }
  }
  async function move(userId: string, code: string, action: "fold" | "call", now: Date) {
    const state = await actions.state(userId, code)
    await actions.act(
      userId,
      code,
      {
        handId: state.handId!,
        street: state.street!,
        actionId: randomUUID(),
        action,
      },
      now,
    )
  }
  it.each([false, true])(
    "排队入座捕获的旧时钟不把旧座位timeout带入新会话，已归档=%s",
    async (archived) => {
      const t = await table(),
        queuedJoinClock = t.at(599)
      await actions.expire(t.code, t.at(600))
      if (archived) expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
      // Model an already captured request clock whose connection/room-lock wait
      // lets another instance expire the old seat first. No service is mocked.
      await poker.join(t.a, t.code, {}, queuedJoinClock)
      await advanceNextHand(actions, t.code)
      const current = await actions.state(t.a, t.code)
      expect(current.handNo).toBe(2)
      await poker.close(t.a, t.code, t.at(606))
      await move(current.actionOnSeat === 0 ? t.a : t.b, t.code, "fold", t.at(607))
      const result = await wait.wait(t.a, t.code, "", 0)
      expect(result).toMatchObject({ status: "table_closed" })
      expect(result).not.toHaveProperty("lastAutoAction")
    },
  )
  it.each([false, true])(
    "旧行动请求稍后开出的合法新手不会漏掉本次timeout，已归档=%s",
    async (archived) => {
      const t = await table(),
        c = randomUUID()
      await poker.join(c, t.code, {}, t.at(110))
      // The join captured at 110s commits before the queued 99s action.
      // The due transition at 104s still opens hand 2 before the join's clock.
      await move(t.a, t.code, "fold", t.at(99))
      await advanceNextHand(actions, t.code)
      const current = await actions.state(c, t.code)
      expect(current.handNo).toBe(2)
      await move(t.b, t.code, "call", t.at(105))
      await actions.expire(t.code, t.at(705))
      await poker.close(t.a, t.code, t.at(706))
      await move(t.a, t.code, "fold", t.at(706))
      if (archived) expect(await archive.archiveHand(current.handId!, new Date())).toBe(true)
      const result = await wait.wait(c, t.code, "", 0)
      expect(result).toMatchObject({
        status: "table_closed",
        lastAutoAction: { handNo: 2, action: "fold", reason: "timeout" },
      })
      expect(await wait.wait(c, t.code, "", 0)).not.toHaveProperty("lastAutoAction")
    },
  )
  it.each([false, true])("请求时钟乱序的合法新手仍可消费本人结算，已归档=%s", async (archived) => {
    const t = await table(),
      c = randomUUID()
    await poker.join(c, t.code, {}, t.at(110))
    await move(t.a, t.code, "fold", t.at(99))
    await advanceNextHand(actions, t.code)
    const current = await actions.state(c, t.code)
    expect(current.handNo).toBe(2)
    await poker.close(t.a, t.code, t.at(105))
    await move(t.b, t.code, "fold", t.at(106))
    await move(c, t.code, "fold", t.at(107))
    if (archived) expect(await archive.archiveHand(current.handId!, new Date())).toBe(true)
    const result = await wait.wait(c, t.code, "2:0", 0)
    expect(result).toMatchObject({
      status: "hand_result",
      handNo: 2,
      result: "lost",
      delta: -1,
      stack: 999,
    })
    expect(await wait.wait(c, t.code, result.cursor, 0)).toMatchObject({ status: "table_closed" })
  })
  it.each([false, true])(
    "缺少持久边界的旧关闭会话仍兼容读取普通结算，已归档=%s",
    async (archived) => {
      const t = await table()
      await poker.close(t.a, t.code, t.at(1))
      await move(t.a, t.code, "fold", t.at(1))
      await db.gameSession.updateMany({
        where: { userId: t.a, roomCode: t.code },
        data: { startCursor: null },
      })
      expect(await db.gamePokerSeat.count({ where: { userId: t.a } })).toBe(0)
      expect(
        await db.gameSession.findFirstOrThrow({ where: { userId: t.a, roomCode: t.code } }),
      ).toMatchObject({ status: "closed", startCursor: null })
      if (archived) expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
      const result = await wait.wait(t.a, t.code, "1:0", 0)
      expect(result).toMatchObject({
        status: "hand_result",
        handNo: 1,
        result: "lost",
        delta: -1,
        stack: 999,
      })
      expect(await wait.wait(t.a, t.code, result.cursor, 0)).toMatchObject({
        status: "table_closed",
      })
    },
  )
  it.each([false, true])(
    "缺少持久边界的旧关闭会话仍兼容读取单次timeout，已归档=%s",
    async (archived) => {
      const t = await table()
      await actions.expire(t.code, t.at(600))
      await db.gameSession.updateMany({
        where: { userId: t.a, roomCode: t.code },
        data: { startCursor: null },
      })
      expect(await db.gamePokerSeat.count({ where: { userId: t.a } })).toBe(0)
      expect(
        await db.gameSession.findFirstOrThrow({ where: { userId: t.a, roomCode: t.code } }),
      ).toMatchObject({ status: "closed", startCursor: null })
      if (archived) expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
      expect(await wait.wait(t.a, t.code, "", 0)).toMatchObject({
        status: "table_closed",
        lastAutoAction: { handNo: 1, action: "fold", reason: "timeout" },
      })
      expect(await wait.wait(t.a, t.code, "", 0)).not.toHaveProperty("lastAutoAction")
    },
  )
})
