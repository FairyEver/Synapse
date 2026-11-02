import { joinForStartedHand } from "./advance-next-hand"
import { afterAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { randomUUID } from "node:crypto"
import type { PrismaService } from "../../../prisma/prisma.service"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { PokerActionService } from "../poker-action.service"
import { PokerWaitService } from "../poker-wait.service"
import { PokerReadService } from "../poker-read.service"
import { PokerArchiveService } from "../poker-archive.service"
import { gameTestDatabaseUrl } from "./test-database"

const url = gameTestDatabaseUrl()
;(url ? describe : describe.skip)("真人控制、历史权限与私有恢复", () => {
  const db = new PrismaClient({ datasources: { db: { url: url ?? "postgresql://localhost/unused_e2e" } } }) as PrismaService
  const hall = new HallService(db), poker = new PokerService(db, hall), actions = new PokerActionService(poker), wait = new PokerWaitService(actions)
  afterAll(async () => { wait.onModuleDestroy(); await db.$disconnect() })
  async function table(mode: "points" | "practice" = "points") {
    const a = randomUUID(), b = randomUUID(), outsider = randomUUID()
    const code = (await poker.createRoom(a, { maxSeats: 3, buyIn: 1000, mode, variant: "short32", blindPreset: "5/10" })).roomCode
    await joinForStartedHand(poker, a, code, {})
    await joinForStartedHand(poker, b, code, {})
    return { a, b, outsider, code }
  }
  it("房规在建房和引擎一致且不能修改", async () => {
    const { a, code } = await table()
    const view = await actions.state(a, code)
    expect(view).toMatchObject({ variant: "short32", smallBlind: 5, bigBlind: 10, toCall: 5 })
    const room = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    const hand = await db.gamePokerHand.findUniqueOrThrow({ where: { id: room.currentHandId! } })
    expect(hand.rules).toMatchObject({ variant: "short32", smallBlind: 5, bigBlind: 10 })
    await expect(db.gamePokerRoom.update({ where: { code }, data: { variant: "standard52" } })).rejects.toThrow()
  })
  it("当前手接管保持筹码和deadline，旧AI不能下注、暂离、离桌", async () => {
    const { a, code } = await table(), before = await actions.state(a, code)
    const controlled = await poker.control(a, code, "takeover", 0)
    const after = await actions.state(a, code)
    expect(after.handId).toBe(before.handId)
    expect(after.seats.map((s) => s.stack)).toEqual(before.seats.map((s) => s.stack))
    expect(after.deadlineMs!).toBeLessThanOrEqual(before.deadlineMs!)
    const input = { handId: before.handId!, street: before.street!, actionId: randomUUID(), action: "call" as const }
    await expect(actions.act(a, code, input)).rejects.toThrow()
    await expect(poker.sit(a, code, true)).rejects.toThrow()
    await expect(poker.leave(a, code)).rejects.toThrow()
    expect(await wait.wait(a, code, "", 0)).toMatchObject({ status: "control_released", controlVersion: controlled.controlVersion })
    await actions.act(a, code, { ...input, controlVersion: controlled.controlVersion, expectedActionSeq: after.actionSeq, note: "不能作为AI判断", personaSource: "game" }, new Date(), "human")
    const written = await db.gamePokerAction.findUniqueOrThrow({ where: { actionId: input.actionId } })
    expect(written).toMatchObject({ actionSource: "human", personaVersionId: null, note: null })
    expect(await actions.act(a, code, input)).toMatchObject({ ok: true })
  })
  it("交接请求不影响真人，接受后新AI必须带版本和行动序号", async () => {
    const { a, code } = await table()
    const human = await poker.control(a, code, "takeover", 0)
    const request = await poker.control(a, code, "request_ai", human.controlVersion)
    expect(request.controller).toBe("human")
    const ai = await poker.claim(a, code, request.controlVersion)
    const current = await actions.state(a, code)
    const input = { handId: current.handId!, street: current.street!, actionId: randomUUID(), action: "call" as const }
    await expect(actions.act(a, code, input)).rejects.toThrow()
    await expect(actions.act(a, code, { ...input, controlVersion: ai.controlVersion, expectedActionSeq: 5 })).rejects.toThrow()
    await actions.act(a, code, { ...input, controlVersion: ai.controlVersion, expectedActionSeq: current.actionSeq })
  })
  it("桌面从未入座可全牌旁观，但MCP与已入座账号都不获取教学牌", async () => {
    const { a, outsider, code } = await table()
    const desktop = await actions.state(outsider, code, "public", false, new Date(), "desktop")
    expect(desktop.seats.every((s) => s.hole?.length === 2)).toBe(true)
    expect((await actions.state(outsider, code, "public")).seats.every((s) => !s.hole)).toBe(true)
    expect((await actions.state(a, code, "public", false, new Date(), "desktop")).seats.every((s) => !s.hole)).toBe(true)
  })
  it("从未参与者看牌后入座只能下一手，离桌后仍不能全牌旁观", async () => {
    const { outsider, code } = await table()
    await joinForStartedHand(poker, outsider, code, {}, new Date(), "human")
    const joined = await actions.state(outsider, code, "public", false, new Date(), "desktop")
    expect(joined.mySeatNo).not.toBeNull()
    expect(joined.seats.every((s) => !s.hole)).toBe(true)
    await poker.leave(outsider, code, new Date(), "human", 0)
    expect((await actions.state(outsider, code, "public", false, new Date(), "desktop")).seats.every((s) => !s.hole)).toBe(true)
  })
  it("维护检查点本人私有，真人接管使自动恢复失效且不更改点数", async () => {
    const user = randomUUID(), code = (await poker.createRoom(user, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, user, code, {})
    await poker.sit(user, code, true, new Date(), "mcp", 0, "context_maintenance")
    const saved = await poker.checkpoint(user, code, { controlVersion: 0, cursor: "0:0", sessionStyle: "临时打法", continueIntent: true })
    expect(saved.checkpoint).toMatchObject({ roomCode: code, sessionStyle: "临时打法", continueIntent: true })
    expect((await poker.checkpoint(randomUUID(), code)).checkpoint).toBeNull()
    await poker.control(user, code, "takeover", 0)
    expect((await poker.checkpoint(user, code)).checkpoint).toBeNull()
    await expect(poker.sit(user, code, false, new Date(), "mcp", 0, "context_maintenance")).rejects.toThrow()
    expect((await hall.overview(user)).points.total).toBe(1000000)
  })
  it("5/10盲注的不足额全下跟注不误计为翻前加注", async () => {
    const user = randomUUID(), code = (await poker.createRoom(user, { maxSeats: 2, buyIn: 1000, blindPreset: "5/10" })).roomCode
    const room = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } })
    const old = new Date(Date.now() - 91 * 86400000)
    const hand = await db.gamePokerHand.create({ data: { roomId: room.id, handNo: 1, dealerSeat: 0, status: "settled", street: "settled", board: [], engineState: {}, startedAt: old, endedAt: old, rules: { variant: "standard52", smallBlind: 5, bigBlind: 10 } } })
    await db.gamePokerHandSeat.createMany({ data: [{ handId: hand.id, userId: user, seatNo: 0, displayName: "小盲", startingStack: 8, holeCards: [] }, { handId: hand.id, userId: randomUUID(), seatNo: 1, displayName: "大盲", startingStack: 100, holeCards: [] }] })
    await db.gamePokerAction.create({ data: { handId: hand.id, roomId: room.id, userId: user, seq: 1, seatNo: 0, street: "preflop", action: "allin", amount: 3, potAfter: 18, actionId: randomUUID() } })
    await db.gamePokerHandSummary.create({ data: { userId: user, roomId: room.id, handId: hand.id, handNo: 1, seatNo: 0, delta: 0, result: "split", holeCards: [], board: [] } })
    expect(await new PokerReadService(poker).stats(user)).toMatchObject({ hands: 1, pfr: 0, vpip: 1, aggression: 0 })
    expect(await new PokerArchiveService(db).archiveHand(hand.id, new Date())).toBe(true)
    expect((await db.gamePokerHandArchive.findUniqueOrThrow({ where: { id: hand.id } })).data).toMatchObject({ hand: { rules: { smallBlind: 5, bigBlind: 10 } } })
    expect(await new PokerReadService(poker).stats(user)).toMatchObject({ hands: 1, pfr: 0, vpip: 1, aggression: 0 })
  })
  it("迟到维护请求不能覆盖用户暂停或离桌意图", async () => {
    const user = randomUUID(), code = (await poker.createRoom(user, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, user, code, {})
    await poker.sit(user, code, true, new Date(), "mcp", 0, "user")
    await expect(poker.sit(user, code, true, new Date(), "mcp", 0, "context_maintenance")).rejects.toThrow()
    await expect(poker.checkpoint(user, code, { controlVersion: 0, cursor: "0:0", continueIntent: true })).rejects.toThrow()
    expect((await actions.state(user, code)).pauseReason).toBe("user")
  })
  it("接管后离桌仍保留控制历史，旧AI不能重扣点，显式新授权可入座", async () => {
    const user = randomUUID(), code = (await poker.createRoom(user, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, user, code, {})
    const human = await poker.control(user, code, "takeover", 0)
    await poker.leave(user, code, new Date(), "human", human.controlVersion)
    await expect(poker.join(user, code, {})).rejects.toThrow()
    expect((await hall.overview(user)).points.available).toBe(1000000)
    const intent = await poker.control(user, code, "request_ai", human.controlVersion)
    await expect(poker.join(user, code, { controlVersion: human.controlVersion })).rejects.toThrow()
    await joinForStartedHand(poker, user, code, { controlVersion: intent.controlVersion })
    expect((await actions.state(user, code)).controller).toBe("ai")
    expect((await hall.overview(user)).points.available).toBe(999000)
  })
  it("接管后的旧MCP查询不替真人续在线心跳", async () => {
    const user = randomUUID(), code = (await poker.createRoom(user, { maxSeats: 2, buyIn: 1000 })).roomCode
    await joinForStartedHand(poker, user, code, {})
    await poker.control(user, code, "takeover", 0)
    const before = await db.gamePokerSeat.findFirstOrThrow({ where: { userId: user } })
    await actions.state(user, code, "owner", true, new Date(before.lastSeenAt.getTime() + 120000))
    expect((await db.gamePokerSeat.findUniqueOrThrow({ where: { id: before.id } })).lastSeenAt).toEqual(before.lastSeenAt)
  })
})
