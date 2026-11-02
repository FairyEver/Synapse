import { joinForStartedHand, prepareAndStartInitialHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerBotService } from "../poker-bot.service"
import { PokerReadService } from "../poker-read.service"
import { PokerWaitService } from "../poker-wait.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("单人陪练立即解散", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db), poker = new PokerService(db, hall)
  const actions = new PokerActionService(poker), bots = new PokerBotService(poker)
  const read = new PokerReadService(poker), wait = new PokerWaitService(actions)
  afterAll(async () => { wait.onModuleDestroy(); await db.$disconnect() })

  async function room(caller: "human" | "mcp" = "mcp", ownerSeated = true) {
    const owner = randomUUID()
    const code = (await poker.createRoom(owner, { maxSeats: 4, buyIn: 1000, mode: "practice" })).roomCode
    await bots.add(owner, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await bots.add(owner, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    if (ownerSeated) await joinForStartedHand(poker, owner, code, {}, new Date(), caller)
    return { owner, code }
  }

  it.each(["human", "mcp"] as const)("%s控制的房主可立即中止牌局，清除调度与会话且不产生战绩或点数", async (caller) => {
    const { owner, code } = await room(caller)
    const before = await actions.state(owner, code)
    expect(before.status).toBe("running")
    const now = new Date()
    expect(await poker.close(owner, code, now)).toEqual({ closed: true })
    const closed = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    expect(closed).toMatchObject({ status: "closed", closedAt: now, actionDeadlineAt: null, botActionAt: null, nextHandAt: null, closeRequested: false })
    expect(await db.gamePokerSeat.count({ where: { roomId: closed.id } })).toBe(0)
    expect(await db.gameSession.findFirst({ where: { gameRoomId: closed.id, userId: owner } })).toMatchObject({ status: "closed", needsAction: false, deadlineAt: null, buyIn: 0, inPlay: 0, returned: 0 })
    const hand = await db.gamePokerHand.findUniqueOrThrow({ where: { id: before.handId! } })
    expect(hand).toMatchObject({ status: "cancelled", endedAt: now, result: null, engineState: { actionOnSeat: null } })
    expect(await db.gamePokerHandSummary.count({ where: { handId: hand.id } })).toBe(0)
    expect((await read.history(owner, 0, 50, "practice")).items).toHaveLength(0)
    expect(await read.stats(owner, undefined, "practice")).toMatchObject({ hands: 0 })
    expect(await wait.wait(owner, code, "1:0", 0)).toMatchObject({ status: "table_closed" })
    expect((await actions.state(owner, code)).actionOnSeat).toBeNull()
    expect((await hall.overview(owner)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
    expect((await hall.overview(owner)).sessions).toHaveLength(0)
    await expect(actions.act(owner, code, { handId: hand.id, street: hand.street, actionId: randomUUID(), action: "fold" })).rejects.toThrow()
    expect(await poker.close(owner, code)).toEqual({ closed: true })
  })

  it("机器人已排队的动作和超时不能在解散后继续牌局", async () => {
    const { owner, code } = await room("human")
    const state = await actions.state(owner, code)
    const running = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    expect(running.botActionAt).not.toBeNull()
    const count = await db.gamePokerAction.count({ where: { handId: state.handId! } })
    await poker.close(owner, code)
    await actions.actBot(code, { handId: state.handId!, scheduledAt: running.botActionAt! }, new Date(running.botActionAt!))
    await actions.expire(code, new Date(running.actionDeadlineAt!))
    expect(await db.gamePokerAction.count({ where: { handId: state.handId! } })).toBe(count)
    expect((await actions.state(owner, code)).status).toBe("closed")
  })

  it("结算展示期间立即解散仍保留已完成结果供AI补发", async () => {
    const owner = randomUUID()
    const code = (await poker.createRoom(owner, { maxSeats: 2, buyIn: 1000, mode: "practice" })).roomCode
    await joinForStartedHand(poker, owner, code, {})
    await bots.add(owner, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    const state = await actions.state(owner, code)
    await actions.act(owner, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" })
    const settled = await db.gamePokerHand.findUniqueOrThrow({ where: { id: state.handId! } })
    expect(settled.status).toBe("settled")
    expect(await poker.close(owner, code)).toEqual({ closed: true })
    expect(await db.gamePokerHand.findUniqueOrThrow({ where: { id: state.handId! } })).toEqual(settled)
    expect(await wait.wait(owner, code, "1:0", 0)).toMatchObject({ status: "hand_result", handNo: 1 })
    expect(await wait.wait(owner, code, "1:2147483647", 0)).toMatchObject({ status: "table_closed" })
    expect((await read.history(owner, 0, 50, "practice")).items).toHaveLength(1)
  })

  it.each(["active", "sitting_out", "waiting"] as const)("其他账号处于%s时仍等待本手完成，不能当作机器人", async (status) => {
    const { owner, code } = await room("mcp", false), other = randomUUID()
    if (status !== "waiting") await joinForStartedHand(poker, other, code, {})
    if (status === "sitting_out") await db.gamePokerSeat.updateMany({ where: { userId: other }, data: { status, sitPending: true } })
    await joinForStartedHand(poker, owner, code, {})
    if (status === "waiting") await joinForStartedHand(poker, other, code, {})
    expect(await poker.close(owner, code)).toEqual({ pending: true })
    expect((await actions.state(owner, code)).status).toBe("running")
  })

  it("房主未入座而其他账号正在陪练时也必须等待", async () => {
    const { owner, code } = await room("mcp", false)
    await joinForStartedHand(poker, randomUUID(), code, {})
    expect(await poker.close(owner, code)).toEqual({ pending: true })
  })

  it("当前手有已超时离桌的其他真人时仍保留其合法结算", async () => {
    const { owner, code } = await room("mcp", false), other = randomUUID()
    await joinForStartedHand(poker, other, code, {})
    await joinForStartedHand(poker, owner, code, {})
    // Departure removes the live seat but preserves participation in this hand.
    await poker.withRoom(code, async (c) => {
      await poker.refund(c, c.seats.find((s) => s.userId === other)!)
    })
    expect(await poker.close(owner, code)).toEqual({ pending: true })
  })

  it("非房主不能立即解散，只有机器人时房主可以关闭", async () => {
    const { owner, code } = await room("mcp", false)
    await expect(poker.close(randomUUID(), code)).rejects.toThrow()
    expect((await actions.state(owner, code)).status).toBe("waiting")
    expect(await poker.close(owner, code)).toEqual({ closed: true })
    expect((await actions.state(owner, code)).seats).toHaveLength(0)
  })
})
