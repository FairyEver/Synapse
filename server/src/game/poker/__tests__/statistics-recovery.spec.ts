import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerReadService } from "../poker-read.service"
import { PokerWaitService } from "../poker-wait.service"
import { PokerArchiveService } from "../poker-archive.service"
import { gameTestDatabaseUrl } from "./test-database"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("全下指标与归档后的恢复", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const poker = new PokerService(db, new HallService(db)),
    actions = new PokerActionService(poker),
    read = new PokerReadService(poker),
    wait = new PokerWaitService(actions),
    archive = new PokerArchiveService(db)
  afterAll(() => {
    wait.onModuleDestroy()
    return db.$disconnect()
  })
  async function table(firstStack = 1000) {
    const a = randomUUID(),
      b = randomUUID(),
      old = new Date(Date.now() - 91 * 86400000),
      code = (await poker.createRoom(a, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(a, code, {}, old)
    if (firstStack !== 1000) {
      await db.gamePokerSeat.updateMany({ where: { userId: a }, data: { stack: firstStack } })
      await db.gameSession.updateMany({ where: { userId: a }, data: { inPlay: firstStack } })
      await db.gameAccount.update({
        where: { userId: a },
        data: { points: { increment: 1000 - firstStack } },
      })
    }
    await poker.join(b, code, {}, old)
    await poker.close(a, code)
    const handId = (await actions.state(a, code)).handId!
    async function move(user: string, action: "call" | "check" | "raise" | "allin", to?: number) {
      const state = await actions.state(user, code)
      await actions.act(
        user,
        code,
        { handId: state.handId!, street: state.street!, actionId: randomUUID(), action, to },
        new Date(old.getTime() + 1),
      )
    }
    return { a, b, old, code, handId, move }
  }
  it.each(["equal", "short", "postflop"])(
    "%s全下跟注不增加PFR或激进度，热表和归档一致",
    async (kind) => {
      const t = await table(kind === "short" ? 500 : 1000)
      if (kind === "equal") {
        await t.move(t.a, "allin")
        await t.move(t.b, "allin")
      } else {
        await t.move(t.a, "call")
        if (kind === "postflop") await t.move(t.b, "check")
        await t.move(t.b, "allin")
        await t.move(t.a, "allin")
      }
      const caller = kind === "equal" ? t.b : t.a,
        bettor = kind === "equal" ? t.a : t.b
      const callerStats = await read.stats(caller),
        bettorStats = await read.stats(bettor)
      expect(callerStats).toMatchObject({ hands: 1, vpip: 1, pfr: 0, aggression: 0 })
      expect(bettorStats).toMatchObject({
        hands: 1,
        vpip: kind === "postflop" ? 0 : 1,
        pfr: kind === "postflop" ? 0 : 1,
        aggression: 1,
      })
      expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
      expect(await read.stats(caller)).toEqual(callerStats)
      expect(await read.stats(bettor)).toEqual(bettorStats)
    },
  )
  it("先跟注再全下加注按累计投入识别为加注", async () => {
    const t = await table()
    await t.move(t.a, "call")
    await t.move(t.b, "raise", 10)
    await t.move(t.a, "allin")
    await t.move(t.b, "call")
    const before = await read.stats(t.a)
    expect(before).toMatchObject({ pfr: 1, aggression: 1 })
    expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
    expect(await read.stats(t.a)).toEqual(before)
  })
  it.each([false, true])("三人非连续座位及按钮轮转后识别盲注，短大盲=%s", async (shortBlind) => {
    const users = Array.from({ length: 5 }, () => randomUUID()),
      [a, b, c, d, e] = users,
      old = new Date(Date.now() - 91 * 86400000),
      code = (await poker.createRoom(a, { maxSeats: 5, buyIn: 1000 })).roomCode
    for (const user of users) await poker.join(user, code, {}, old)
    if (shortBlind) {
      await db.gamePokerSeat.updateMany({ where: { userId: e }, data: { stack: 1 } })
      await db.gameSession.updateMany({ where: { userId: e }, data: { inPlay: 1 } })
      await db.gameAccount.update({ where: { userId: e }, data: { points: { increment: 999 } } })
    }
    await poker.leave(d, code, old)
    await poker.leave(a, code, old)
    let state = await actions.state(a, code)
    await actions.act(
      a,
      code,
      { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" },
      old,
    )
    state = await actions.state(b, code)
    expect(state.dealerSeat).toBe(1)
    expect(state.seats.map((s) => s.seatNo)).toEqual([1, 2, 4])
    const handId = state.handId!
    await poker.close(a, code)
    async function move(user: string, action: "call" | "allin" | "fold") {
      const current = await actions.state(user, code)
      await actions.act(
        user,
        code,
        { handId, street: current.street!, actionId: randomUUID(), action },
        new Date(old.getTime() + 1),
      )
    }
    await move(b, "call")
    await move(c, "allin")
    if (shortBlind) await move(b, "call")
    else {
      await move(e, "allin")
      await move(b, "fold")
    }
    const before = await read.stats(e),
      raiser = await read.stats(c)
    expect(before).toMatchObject({ hands: 1, vpip: shortBlind ? 0 : 1, pfr: 0, aggression: 0 })
    expect(raiser).toMatchObject({ hands: 1, vpip: 1, pfr: 1, aggression: 1 })
    expect(await archive.archiveHand(handId, new Date())).toBe(true)
    expect(await read.stats(e)).toEqual(before)
    expect(await read.stats(c)).toEqual(raiser)
  })
  it("未消费的超时事件归档后仍返回一次，随后保持已消费", async () => {
    const t = await table()
    await actions.expire(t.code, new Date(t.old.getTime() + 600000))
    expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
    const result = await wait.wait(t.a, t.code, "", 0)
    expect(result).toMatchObject({
      status: "table_closed",
      lastAutoAction: { handNo: 1, action: "fold", reason: "timeout" },
    })
    expect(await wait.wait(t.a, t.code, "", 0)).not.toHaveProperty("lastAutoAction")
  })
  it("热表已消费的超时事件归档后不再重复返回", async () => {
    const t = await table()
    await actions.expire(t.code, new Date(t.old.getTime() + 600000))
    expect(await wait.wait(t.a, t.code, "", 0)).toHaveProperty("lastAutoAction")
    expect(await archive.archiveHand(t.handId, new Date())).toBe(true)
    expect(await wait.wait(t.a, t.code, "", 0)).not.toHaveProperty("lastAutoAction")
  })
})
