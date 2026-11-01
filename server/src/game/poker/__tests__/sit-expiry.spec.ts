import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("连续暂离的30分钟期限", () => {
  const db = new PrismaClient({
    datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } },
  }) as PrismaService
  const hall = new HallService(db),
    poker = new PokerService(db, hall),
    actions = new PokerActionService(poker)
  afterAll(() => db.$disconnect())
  async function table() {
    const userId = randomUUID(),
      base = new Date(),
      code = (await poker.createRoom(userId, { maxSeats: 2, buyIn: 1000 })).roomCode
    await poker.join(userId, code, {}, base)
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60000)
    return { userId, code, at }
  }
  async function seats(userId: string) {
    return db.gamePokerSeat.count({ where: { userId } })
  }
  it("重复请求已生效的暂离不会续租，仍在首次暂离满30分钟时退座退款", async () => {
    const t = await table()
    await poker.sit(t.userId, t.code, true, t.at(0))
    await poker.sit(t.userId, t.code, true, t.at(29))
    await poker.maintain(t.code, t.at(30))
    expect(await seats(t.userId)).toBe(0)
    expect((await hall.overview(t.userId)).points).toEqual({
      total: 1000000,
      available: 1000000,
      inPlay: 0,
      pending: 0,
      netProfit: 0,
    })
    expect((await hall.overview(t.userId)).sessions).toEqual([])
  })
  it("真正回座后再暂离重新计时，心跳不替代暂离期限", async () => {
    const t = await table()
    await poker.sit(t.userId, t.code, true, t.at(0))
    await poker.sit(t.userId, t.code, false, t.at(20))
    await poker.sit(t.userId, t.code, true, t.at(25))
    await poker.maintain(t.code, t.at(30))
    expect(await seats(t.userId)).toBe(1)
    await actions.state(t.userId, t.code, "owner", true, t.at(54))
    await poker.maintain(t.code, t.at(55))
    expect(await seats(t.userId)).toBe(0)
    expect((await hall.overview(t.userId)).points.available).toBe(1000000)
  })
  it("本手中的暂离申请不提前计时，从结算实际进入暂离开始计算", async () => {
    const t = await table(),
      other = randomUUID()
    await poker.join(other, t.code, {}, t.at(0))
    expect(await poker.sit(t.userId, t.code, true, t.at(0))).toMatchObject({
      pending: true,
      status: "active",
    })
    await poker.sit(t.userId, t.code, true, t.at(5))
    const hand = await actions.state(t.userId, t.code)
    await actions.act(
      t.userId,
      t.code,
      {
        handId: hand.handId!,
        street: hand.street!,
        actionId: randomUUID(),
        action: "fold",
      },
      t.at(9),
    )
    await actions.state(other, t.code, "owner", true, t.at(29))
    await poker.maintain(t.code, t.at(30))
    expect(await seats(t.userId)).toBe(1)
    expect((await hall.overview(t.userId)).sessions[0].status).toBe("sitting_out")
    await poker.maintain(t.code, t.at(39))
    expect(await seats(t.userId)).toBe(0)
    expect((await hall.overview(t.userId)).points.available).toBe(999999)
    expect(
      (await hall.overview(t.userId)).points.total + (await hall.overview(other)).points.total,
    ).toBe(2000000)
  })
})
