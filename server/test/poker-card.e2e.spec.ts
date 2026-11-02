import { afterAll, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import type { PrismaService } from "../src/prisma/prisma.service"
import { HallService } from "../src/game/hall/hall.service"
import { PokerService } from "../src/game/poker/poker.service"
import { PokerActionService } from "../src/game/poker/poker-action.service"
import { PokerCardService } from "../src/game/poker/poker-card.service"
import { PokerReadService } from "../src/game/poker/poker-read.service"
import { PokerArchiveService } from "../src/game/poker/poker-archive.service"
import { quoteCardPlay } from "../src/game/poker/engine/cards/commands"
import { createCardRegistry } from "../src/game/poker/engine/cards/catalog-v1"
import type { HandState } from "../src/game/poker/engine/hand-runner"
import { gameTestDatabaseUrl } from "../src/game/poker/__tests__/test-database"
import { prepareAndStartInitialHand } from "../src/game/poker/__tests__/advance-next-hand"

const url = gameTestDatabaseUrl()
if (!url) throw new Error("GAME_E2E_DATABASE_URL必须显式配置；本套件不允许跳过真实数据库")
const db = new PrismaClient({ datasources: { db: { url } } }) as PrismaService
const hall = new HallService(db), poker = new PokerService(db, hall), actions = new PokerActionService(poker), cards = new PokerCardService(poker)
afterAll(async () => { vi.restoreAllMocks(); await db.$disconnect() })

async function fixture(humans = 2, now = new Date()) {
  const users = Array.from({ length: humans }, () => randomUUID())
  const code = (await poker.createRoom(users[0], { maxSeats: humans, buyIn: 1000, ruleOptions: { cards: true, roll: true } }, "human", true)).roomCode
  for (const user of users) await poker.join(user, code, {}, now, "human")
  await prepareAndStartInitialHand(poker, code, now)
  const room = await db.gamePokerRoom.findUniqueOrThrow({ where: { code } }), handId = room.currentHandId!
  async function input(id: string, user = users[0]) {
    const hand = await db.gamePokerHand.findUniqueOrThrow({ where: { id: handId } }), h = hand.engineState as unknown as HandState
    const actor = h.participants!.find(p => p.userId === user)!, own = h.cards!.hands[actor.admissionId]
    let instance = own.find(c => c.definitionId === id)
    if (!instance) for (const zone of [h.cards!.pool, ...Object.values(h.cards!.hands)]) {
      const index = zone.findIndex(c => c.definitionId === id)
      if (index >= 0) { instance = zone.splice(index, 1)[0]; own.push(instance); break }
    }
    if (!instance) throw new Error(`Fixture card unavailable: ${id}`)
    await db.gamePokerHand.update({ where: { id: handId }, data: { engineState: h as unknown as Prisma.InputJsonValue } })
    const seat = await db.gamePokerSeat.findUniqueOrThrow({ where: { id: actor.admissionId } })
    const request = { roomCode: code, handId, street: h.street as "preflop", expectedActionSeq: hand.actionSeq, controlVersion: seat.controlVersion, actionId: randomUUID(), instanceId: instance.id, selections: {}, expectedPaymentVersion: "" }
    request.expectedPaymentVersion = quoteCardPlay(h, request, createCardRegistry()).version
    return request
  }
  async function act(user: string, action: "call" | "check" | "fold") {
    const state = await actions.state(user, code, "owner", false, now, "desktop")
    await actions.act(user, code, { handId, street: state.street!, expectedActionSeq: state.actionSeq!, controlVersion: state.controlVersion!, actionId: randomUUID(), action, expectedPaymentVersion: state.paymentVersion }, now, "human")
  }
  async function turn(user: string) {
    for (let i = 0; i < 12; i++) {
      const hand = await db.gamePokerHand.findUniqueOrThrow({ where: { id: handId } }), h = hand.engineState as unknown as HandState
      if (h.participants!.find(p => p.seatNo === h.actionOnSeat)!.userId === user) return
      const actor = h.participants!.find(p => p.seatNo === h.actionOnSeat)!
      await act(actor.userId, h.currentBet > h.seats.find(s => s.seatNo === actor.seatNo)!.streetBet ? "call" : "check")
    }
    throw new Error("Expected actor did not receive a turn")
  }
  return { users, now, code, room, handId, input, act, turn }
}

describe("真实PostgreSQL卡牌与暂存事务", () => {
  it("90天热冷归档保留根帧、卡牌去向、私有投影和永久幂等回执", async () => {
    const f = await fixture(2, new Date(Date.now() - 91 * 86400000)), input = await f.input("11")
    const result = await cards.play(f.users[0], input, "human", f.now)
    const h = (await db.gamePokerHand.findUniqueOrThrow({ where: { id: f.handId } })).engineState as unknown as HandState
    const secret = h.cards!.privateResults[0].values[0]
    await f.act(f.users[0], "fold")
    const read = new PokerReadService(poker), owner = await read.detail(f.users[0], f.code, 1), other = await read.detail(f.users[1], f.code, 1)
    expect(JSON.stringify(other)).not.toContain(secret)
    expect(await new PokerArchiveService(db).archiveHand(f.handId, new Date())).toBe(true)
    expect(await db.gamePokerHand.count({ where: { id: f.handId } })).toBe(0)
    expect(await db.gamePokerResolution.count({ where: { handId: f.handId } })).toBe(0)
    const archive = await db.gamePokerHandArchive.findUniqueOrThrow({ where: { id: f.handId } })
    expect((archive.data as unknown as { resolutions: unknown[] }).resolutions).toHaveLength(3)
    expect(await read.detail(f.users[0], f.code, 1)).toEqual(owner)
    expect(await read.detail(f.users[1], f.code, 1)).toEqual(other)
    expect(await cards.play(f.users[0], input, "human", new Date())).toEqual(result)
  })
  it("同UUID并发只扣一次、一个帧、一份永久回执和一笔暂存", async () => {
    const f = await fixture(), input = await f.input("38")
    const [a, b] = await Promise.all([cards.play(f.users[0], input, "human", f.now), cards.play(f.users[0], input, "human", f.now)])
    expect(a).toEqual(b)
    expect(await db.gamePokerResolution.count({ where: { handId: f.handId, seq: 1 } })).toBe(1)
    expect(await db.gamePokerActionReceipt.count({ where: { actionId: input.actionId } })).toBe(1)
    expect(await db.gameReserveLot.findMany({ where: { settlementId: f.handId }, take: 10 })).toMatchObject([{ originalAmount: 4, remainingAmount: 4 }])
    expect(await db.gameReserveMovement.count({ where: { settlementId: f.handId } })).toBe(1)
    expect((await hall.overview(f.users[1])).points.pending).toBe(4)
    expect(await cards.play(f.users[0], input, "human", f.now)).toEqual(a)
    await expect(cards.play(f.users[0], input, "mcp", f.now)).rejects.toThrow()
  })
  it("实际分录写完后异常，状态、钱包、分录、动作和回执一起回滚", async () => {
    const f = await fixture(), input = await f.input("38"), before = await db.gamePokerHand.findUniqueOrThrow({ where: { id: f.handId } })
    const apply = poker.reserves.apply.bind(poker.reserves), spy = vi.spyOn(poker.reserves, "apply").mockImplementation(async (...args) => { await apply(...args); throw new Error("after real financial writes") })
    try { await expect(cards.play(f.users[0], input, "human", f.now)).rejects.toThrow("after real financial writes") }
    finally { spy.mockRestore() }
    expect(await db.gamePokerHand.findUniqueOrThrow({ where: { id: f.handId } })).toEqual(before)
    expect(await db.gameReserveLot.count({ where: { settlementId: f.handId } })).toBe(0)
    expect(await db.gameReserveMovement.count({ where: { settlementId: f.handId } })).toBe(0)
    expect(await db.gamePokerActionReceipt.count({ where: { actionId: input.actionId } })).toBe(0)
    expect(await db.gamePokerResolution.count({ where: { handId: f.handId, seq: { gt: 0 } } })).toBe(0)
  })
  it("存入→盗取→退款经过实际行动位，逐步资金守恒且原份额可追溯", async () => {
    const f = await fixture(3)
    const total = async () => (await Promise.all(f.users.map(u => hall.overview(u)))).reduce((n, v) => n + v.points.total, 0)
    const initial = await total()
    await cards.play(f.users[0], await f.input("38"), "human", f.now); expect(await total()).toBe(initial)
    await f.turn(f.users[1]); await cards.play(f.users[1], await f.input("33", f.users[1]), "human", f.now); expect(await total()).toBe(initial)
    expect(await db.gameReserveClaim.findMany({ where: { settlementId: f.handId }, orderBy: { seatNo: "asc" }, take: 10 })).toMatchObject([{ seatNo: 1, remainingAmount: 2 }, { seatNo: 2, remainingAmount: 0 }])
    await f.turn(f.users[0]); await cards.play(f.users[0], await f.input("35"), "human", f.now); expect(await total()).toBe(initial)
    expect(await db.gameReserveMovement.findMany({ where: { settlementId: f.handId }, orderBy: { createdAt: "asc" }, take: 10 })).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "deposit", amount: 4 }), expect.objectContaining({ kind: "steal", amount: 2 }), expect.objectContaining({ kind: "refund", amount: 2 })]))
    await f.act(f.users[0], "fold"); await f.act(f.users[1], "fold")
    expect(await db.gameReserveLot.findMany({ where: { settlementId: f.handId }, take: 10 })).toMatchObject([{ status: "finalized", remainingAmount: 0 }])
    expect((await db.gamePokerHand.findUniqueOrThrow({ where: { id: f.handId } })).status).toBe("settled")
    expect(await total()).toBe(initial)
  })
  it("最终释放与并发overview只返回完整快照，离开重入不继承旧份额", async () => {
    const f = await fixture(3), actor = f.users[0], receiver = f.users[1]
    await cards.play(actor, await f.input("38"), "human", f.now)
    const original = await db.gamePokerSeat.findFirstOrThrow({ where: { roomId: f.room.id, userId: receiver } })
    await f.act(actor, "call")
    const deadline = (await db.gamePokerRoom.findUniqueOrThrow({ where: { id: f.room.id } })).actionDeadlineAt!
    await actions.expire(f.code, deadline)
    f.now.setTime(deadline.getTime() + 1)
    await poker.join(receiver, f.code, {}, f.now, "human")
    const fresh = await db.gamePokerSeat.findFirstOrThrow({ where: { roomId: f.room.id, userId: receiver } })
    expect(fresh.id).not.toBe(original.id)
    const account = await db.gameAccount.findUniqueOrThrow({ where: { userId: receiver } })
    const before = await hall.overview(receiver), reads = Array.from({ length: 16 }, () => hall.overview(receiver))
    const h = (await db.gamePokerHand.findUniqueOrThrow({ where: { id: f.handId } })).engineState as unknown as HandState
    const current = h.participants!.find(p => p.seatNo === h.actionOnSeat)!
    await Promise.all([f.act(current.userId, "fold"), ...reads])
    const after = await hall.overview(receiver), snapshots = await Promise.all(reads)
    for (const view of snapshots) expect([[before.points.available, before.points.pending], [after.points.available, after.points.pending]]).toContainEqual([view.points.available, view.points.pending])
    expect(after.points.pending).toBe(0)
    expect((await db.gameAccount.findUniqueOrThrow({ where: { userId: receiver } })).points).toBe(account.points + 2)
    expect((await db.gamePokerSeat.findUniqueOrThrow({ where: { id: fresh.id } })).stack).toBe(fresh.stack)
    const transfers = await db.gamePendingTransfer.findMany({ where: { settlementId: f.handId, userId: receiver }, take: 10 })
    expect(transfers).toMatchObject([{ admissionId: original.id, status: "released", releasedTo: "account", amount: 2 }])
  })
  it("SQL拒绝负额、资金来源篡改、账本和帧更新删除", async () => {
    const f = await fixture(), input = await f.input("38"); await cards.play(f.users[0], input, "human", f.now)
    const lot = await db.gameReserveLot.findFirstOrThrow({ where: { settlementId: f.handId } })
    const move = await db.gameReserveMovement.findFirstOrThrow({ where: { settlementId: f.handId } })
    await expect(db.gameReserveLot.update({ where: { id: lot.id }, data: { remainingAmount: -1 } })).rejects.toThrow()
    await expect(db.gameReserveLot.update({ where: { id: lot.id }, data: { payerAdmissionId: randomUUID() } })).rejects.toThrow()
    await expect(db.gameReserveMovement.update({ where: { id: move.id }, data: { amount: 1 } })).rejects.toThrow()
    await expect(db.gameReserveMovement.delete({ where: { id: move.id } })).rejects.toThrow()
    await expect(db.gamePokerResolution.updateMany({ where: { handId: f.handId }, data: { source: "forged" } })).rejects.toThrow()
    await expect(db.gamePokerResolution.deleteMany({ where: { handId: f.handId } })).rejects.toThrow()
  })
  it("旧冻结记录及NULL版本保留，正额暂存阻止补助重复发放", async () => {
    const user = randomUUID(), sourceId = randomUUID(), settlementId = randomUUID()
    const legacy = await db.gamePokerRoom.create({ data: { code: randomUUID(), ownerUserId: user, maxSeats: 2, buyIn: 1000, ruleOptions: { roll: true }, rollPricingVersion: "roll-v1" } })
    const old = await db.gamePendingTransfer.create({ data: { sourceId, settlementId, gameKind: "poker", gameRoomId: legacy.id, userId: user, admissionId: randomUUID(), funding: "points", amount: 7 } })
    await hall.overview(user)
    expect(await db.gamePendingTransfer.findUniqueOrThrow({ where: { id: old.id } })).toEqual(old)
    expect(await db.gamePokerRoom.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ cardRulesVersion: null, chipRulesVersion: null })
    await expect(db.gamePokerRoom.update({ where: { id: legacy.id }, data: { chipRulesVersion: "chips-v2" } })).rejects.toThrow()
    const f = await fixture(); await cards.play(f.users[0], await f.input("38"), "human", f.now)
    await db.gameAccount.update({ where: { userId: f.users[1] }, data: { points: 0 } })
    await db.gameSession.updateMany({ where: { userId: f.users[1] }, data: { inPlay: 0 } })
    await expect(hall.grant(f.users[1])).rejects.toThrow()
  })
})
