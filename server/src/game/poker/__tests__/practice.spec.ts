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
import { startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import { engine, saveHand } from "../poker-lifecycle"
const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("程序机器人陪练生命周期", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db), poker = new PokerService(db, hall), actions = new PokerActionService(poker), bots = new PokerBotService(poker)
  afterAll(() => db.$disconnect())
  async function room(maxSeats = 3) {
    const u = randomUUID()
    const { roomCode: code } = await poker.createRoom(u, { maxSeats, buyIn: 1000, mode: "practice" })
    return { u, code }
  }
  it("机器人无账号/会话，仅机器人不发牌，真人入座不扣点且正常开局", async () => {
    const { u, code } = await room()
    const bot = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    expect((await actions.state(u, code)).handNo).toBe(0)
    const seat = await db.gamePokerSeat.findUniqueOrThrow({ where: { id: bot.botId } })
    expect(seat.participantKind).toBe("bot")
    expect(await db.gameAccount.findUnique({ where: { userId: seat.userId } })).toBeNull()
    expect(await db.gameSession.count({ where: { userId: seat.userId } })).toBe(0)
    await joinForStartedHand(poker, u, code, {})
    const state = await actions.state(u, code)
    expect(state).toMatchObject({ mode: "practice", handNo: 1, status: "running" })
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
    expect((await hall.overview(u)).sessions[0]).toMatchObject({ funding: "practice" })
    expect(state.seats.find((s) => s.participantKind === "bot")?.hole).toBeUndefined()
    await expect(actions.act(seat.userId, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "call" })).rejects.toThrow()
  })
  it("非房主与点数房拒绝机器人，机器人不能占满所有座位", async () => {
    const { u, code } = await room(2)
    await expect(bots.add(randomUUID(), code, randomUUID())).rejects.toThrow()
    const bot = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await expect(bots.add(u, code, randomUUID())).rejects.toThrow()
    await expect(bots.remove(randomUUID(), code, bot.botId)).rejects.toThrow()
    const pointCode = (await poker.createRoom(u, { maxSeats: 2, buyIn: 1000 })).roomCode
    await expect(bots.add(u, pointCode, randomUUID())).rejects.toThrow()
    await expect(db.gamePokerRoom.update({ where: { code }, data: { mode: "points" } })).rejects.toThrow()
  })
  it("创建重试不重复，移除后重试原创建标识不复活", async () => {
    const { u, code } = await room(), id = randomUUID()
    const result = await bots.add(u, code, id)
    expect(await bots.add(u, code, id)).toEqual(result)
    await bots.remove(u, code, result.botId)
    expect(await bots.add(u, code, id)).toEqual(result)
    expect((await actions.state(u, code)).seats).toHaveLength(0)
    await expect(bots.remove(u, code, result.botId)).resolves.toEqual({ pending: false })
  })
  it("在局新增下一手参与，移除当前机器人只标记手后离场", async () => {
    const { u, code } = await room(), bot = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await joinForStartedHand(poker, u, code, {})
    const second = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    const state = await actions.state(u, code)
    expect(state.seats.find((s) => s.seatNo === second.seatNo)?.hole).toBeUndefined()
    expect(await bots.remove(u, code, bot.botId)).toEqual({ pending: true })
    expect(await bots.remove(u, code, second.botId)).toEqual({ pending: false })
  })
  it("无真人参与时仍按真人活动维护，不被机器人在线状态续命", async () => {
    const { u, code } = await room()
    await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    const now = new Date()
    await db.gamePokerRoom.update({ where: { code }, data: { createdAt: new Date(now.getTime() - 1800001) } })
    await poker.maintain(code, now)
    expect((await actions.state(u, code)).status).toBe("closed")
    expect((await actions.state(u, code)).seats).toHaveLength(0)
    expect(await db.gameAccount.findUnique({ where: { userId: u } })).toBeNull()
  })
  it("真人陪练离座/解散均不退点，练习会话保持零占用", async () => {
    const { u, code } = await room()
    await joinForStartedHand(poker, u, code, {})
    await poker.leave(u, code)
    const code2 = (await room()).code
    await joinForStartedHand(poker, u, code2, {})
    await poker.leave(u, code2)
    await poker.close(u, code)
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
    expect(await db.gameSession.findMany({ where: { userId: u } })).toEqual(expect.arrayContaining([expect.objectContaining({ inPlay: 0, buyIn: 0, returned: 0, status: "closed" })]))
  })
  it.each(["leave", "close", "timeout"])("手中%s和计分桌退款并发仍不兑换练习筹码", async (exit) => {
    const { u, code } = await room(2)
    const points = (await poker.createRoom(u, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, u, points, {})
    await joinForStartedHand(poker, u, code, {})
    await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    const state = await actions.state(u, code)
    if (exit === "timeout") {
      const r = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
      await Promise.all([actions.expire(code, new Date(r.actionDeadlineAt!)), poker.close(u, points)])
    } else {
      await Promise.all([exit === "leave" ? poker.leave(u, code) : poker.close(u, code), poker.close(u, points)])
      if (exit !== "close") await actions.act(u, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "fold" })
    }
    expect((await actions.state(u, code)).status).toBe(exit === "close" ? "closed" : "paused")
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
    expect(await db.gameSession.findFirst({ where: { userId: u, funding: "practice" } })).toMatchObject({ status: "closed", buyIn: 0, inPlay: 0, returned: 0 })
  })
  it.each(["bot", "human"])("%s输光立即移出，不补筹码也不增加账户点数", async (loser) => {
    const { u, code } = await room(2)
    await joinForStartedHand(poker, u, code, {})
    const bot = await bots.add(u, code, randomUUID())
    await prepareAndStartInitialHand(poker, code)
    await poker.withRoom(code, async (c) => {
      const hand = await c.tx.gamePokerHand.findUniqueOrThrow({ where: { id: c.room.currentHandId! } })
      const prefix = loser === "bot" ? ["Ks", "As", "Kh", "Ah"] : ["As", "Ks", "Ah", "Kh"]
      prefix.push("4d", "2s", "3h", "7d", "5c", "9c", "6h", "Jd")
      const deck = [...prefix, ...orderedDeck().filter((card) => !prefix.includes(card))]
      const h = startHand(c.seats.map((s) => ({ seatNo: s.seatNo, stack: s.participantKind === loser ? 2 : 1000 })), 0, deck, engine(hand))
      Object.assign(h, { participants: engine(hand).participants, turnClock: engine(hand).turnClock })
      for (const seat of h.seats) await c.tx.gamePokerHandSeat.updateMany({ where: { handId: hand.id, seatNo: seat.seatNo }, data: { startingStack: seat.startingStack, holeCards: seat.hole } })
      await saveHand(poker, c, hand, h)
    })
    const state = await actions.state(u, code)
    await actions.act(u, code, { handId: state.handId!, street: state.street!, actionId: randomUUID(), action: "call" })
    const after = await actions.state(u, code)
    expect(after.status).toBe("paused")
    expect(after.handNo).toBe(1)
    const roomId = (await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })).id
    expect(await db.gamePokerSeat.count({ where: { roomId, ...(loser === "bot" ? { id: bot.botId } : { userId: u }) } })).toBe(0)
    const losingSeatNo = state.seats.find((s) => s.participantKind === loser)!.seatNo
    expect(after.seats.find((s) => s.seatNo === losingSeatNo)).toMatchObject({ stack: 0, status: "left" })
    if (loser === "human") expect(after.mySeatNo).toBeNull()
    expect(await db.gamePokerBot.count({ where: { id: bot.botId } })).toBe(1)
    expect((await hall.overview(u)).points).toEqual({ total: 1000000, available: 1000000, inPlay: 0, pending: 0, netProfit: 0 })
  })
})
