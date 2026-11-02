import { joinForStartedHand, prepareAndStartInitialHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerBotService } from "../poker-bot.service"
import { gameTestDatabaseUrl } from "./test-database"
import { advanceNextHand, scopedBotTask } from "./advance-next-hand"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("陪练机器人行动调度", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db), poker = new PokerService(db, hall), actions = new PokerActionService(poker), bots = new PokerBotService(poker)
  afterAll(() => db.$disconnect())
  async function room() {
    const u = randomUUID(), code = (await poker.createRoom(u, { maxSeats: 2, buyIn: 1000, mode: "practice" })).roomCode
    await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await joinForStartedHand(poker, u, code, {})
    return { u, code }
  }
  it("两实例竞争只产生一个动作，旧调度不操作新行动点", async () => {
    const { code } = await room(), r = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    const expected = { handId: r.currentHandId!, scheduledAt: r.botActionAt! }, now = new Date(r.botActionAt!)
    await Promise.all([actions.actBot(code, expected, now), actions.actBot(code, expected, now)])
    expect(await db.gamePokerAction.count({ where: { roomId: r.id, actionSource: "rules_bot" } })).toBe(1)
    await actions.actBot(code, expected, new Date(now.getTime() + 10000))
    expect(await db.gamePokerAction.count({ where: { roomId: r.id, actionSource: "rules_bot" } })).toBe(1)
    const move = await db.gamePokerAction.findFirstOrThrow({ where: { roomId: r.id } })
    expect(move.isAuto).toBe(false)
    expect(move.note).toBeNull()
  })
  it("实际规则和调度连续完成50手，重建调度器可继续，账户不变", async () => {
    const { u, code } = await room()
    let now = new Date(Date.now() + 2000)
    for (let step = 0; step < 1400; step++) {
      const state = await actions.state(u, code)
      if (state.handNo >= 51) break
      if (state.street === "settled") { now = await advanceNextHand(actions, code); continue }
      if (state.status !== "running") break
      const active = state.seats.find((s) => s.seatNo === state.actionOnSeat)!
      if (active.participantKind === "bot") await scopedBotTask(actions, code).scan(now)
      else await actions.act(u, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: state.toCall ? "call" : "check" }, now)
      now = new Date(now.getTime() + 1100)
    }
    expect((await actions.state(u, code)).handNo).toBeGreaterThanOrEqual(51)
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
  }, 30000)
  it("最后真人暂离后本手结束即暂停，机器人不自转", async () => {
    const { u, code } = await room()
    await poker.sit(u, code, true)
    let now = new Date(Date.now() + 2000)
    for (let i = 0; i < 30; i++) {
      const state = await actions.state(u, code)
      if (state.status !== "running") break
      if (state.seats.find((s) => s.seatNo === state.actionOnSeat)?.participantKind === "bot") await scopedBotTask(actions, code).scan(now)
      else await actions.act(u, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" }, now)
      now = new Date(now.getTime() + 1100)
    }
    expect((await actions.state(u, code)).status).toBe("paused")
  })
})
