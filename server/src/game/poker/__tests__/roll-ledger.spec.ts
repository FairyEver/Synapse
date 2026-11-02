import { randomUUID } from "node:crypto"
import type { GamePokerHandSeat, GamePokerRoll } from "@prisma/client"
import { describe, expect, it } from "vitest"
import { projectRollLedger } from "../poker-roll-ledger"
import type { HandState, RollHistory } from "../engine/hand-runner"
import { PokerRollService } from "../poker-roll.service"
import { PokerActionService } from "../poker-action.service"
import { quoteRoll } from "../engine/hand-runner"
import { act } from "../engine/hand-runner"
import { saveHand } from "../poker-lifecycle"
import { rollStore } from "./roll-service-store"

const participants = [0, 1, 2].map(seatNo => ({ seatNo, userId: `user-${seatNo}`, admissionId: `admission-${seatNo}`, displayName: `原玩家${seatNo}`, folded: seatNo === 1 })) as GamePokerHandSeat[]
const records: RollHistory[] = [40, 120, 63, 180].map((fee, i) => ({ id: `r${i}`, seatNo: 0, fee, kind: i % 2 ? "super" : "normal", street: "preflop", compensations: { 1: Math.ceil(fee / 2), 2: Math.floor(fee / 2) }, cardIndex: 1, oldCard: "As", candidates: ["Ks", "Qs", "Js"], selectedIndex: i === 3 ? null : 0, count: i + 1 }))
const state = (history = records, released = false) => ({ seats: participants.map(p => ({ seatNo: p.seatNo, folded: p.folded })), roll: { history, released } }) as HandState
const base = { roomId: "room", userId: "user-0", hand: { id: "hand", status: "running" }, participants }
const archived = (r: RollHistory, startSeq: number): GamePokerRoll => ({ id: r.id, roomId: "room", handId: "hand", userId: "user-0", admissionId: "admission-0", seatNo: 0, startSeq, chooseSeq: startSeq + 1, data: r, createdAt: new Date(startSeq * 1000), completedAt: null }) as unknown as GamePokerRoll

describe("Roll费用本手公开投影", () => {
  it("每个成功start保留一条，全额403按原补偿分配，后续弃牌仍保留归属", () => {
    const ledger = projectRollLedger({ ...base, state: state() })!
    expect(ledger).toMatchObject({ handId: "hand", status: "pending" })
    expect(ledger.entries.map(entry => entry.fee)).toEqual([40, 120, 63, 180])
    expect(ledger.entries.reduce((sum, entry) => sum + entry.fee, 0)).toBe(403)
    const recipient = ledger.players.find(player => player.seatNo === 1)!
    expect(recipient.folded).toBe(true)
    expect(ledger.entries[2].compensations).toContainEqual({ key: recipient.key, amount: 32 })
    expect(ledger.entries[0].payerKey).toBe(ledger.players[0].key)
    for (const field of ["userId", "admissionId", "cardIndex", "oldCard", "candidates", "selectedIndex"]) expect(JSON.stringify(ledger)).not.toContain(`"${field}"`)
  })
  it("热历史去重而不截断，choose及待选重抽保留原收费而不重复", () => {
    const history = Array.from({ length: 45 }, (_, i) => ({ ...records[0], id: `r${i}` }))
    const ledger = projectRollLedger({ ...base, state: state([...history, history[2]]) })!
    expect(ledger.entries).toHaveLength(45)
    expect(ledger.entries[44].id).toBe("r44")
    expect(ledger.entries.reduce((sum, entry) => sum + entry.fee, 0)).toBe(1800)
  })
  it("归档按startSeq恢复真实顺序并去重，身份只取本手快照且与热key相同", () => {
    const rows = [archived(records[2], 5), archived(records[0], 1), archived(records[1], 3), archived(records[0], 1)]
    const cold = projectRollLedger({ ...base, hand: { id: "hand", status: "settled" }, archivedRolls: rows })!
    const hot = projectRollLedger({ ...base, state: state() })!
    expect(cold.entries.map(entry => entry.id)).toEqual(["r0", "r1", "r2"])
    expect(cold.status).toBe("released")
    expect(cold.players).toEqual(hot.players)
    expect(cold.players[0]).toMatchObject({ displayName: "原玩家0", isMe: true })
    const otherRoom = projectRollLedger({ ...base, roomId: "other-room", state: state() })!
    expect(otherRoom.players[0].key).not.toBe(hot.players[0].key)
    const fresh = projectRollLedger({ ...base, userId: "fresh", state: state() })!
    expect(fresh.players.some(player => player.isMe)).toBe(false)
  })
  it("取消优先于已释放标记，已结算的热手仍保留明细", () => {
    expect(projectRollLedger({ ...base, hand: { id: "hand", status: "cancelled" }, state: state(records, true) })).toMatchObject({ status: "cancelled", entries: expect.any(Array) })
    expect(projectRollLedger({ ...base, hand: { id: "hand", status: "settled" }, state: state(records, true) })).toMatchObject({ status: "released", entries: expect.any(Array) })
  })
  it("已知空历史返回空账本，缺失来源/身份/不守恒记录不伪造完整账本", () => {
    expect(projectRollLedger({ ...base, state: state([]) })?.entries).toEqual([])
    expect(projectRollLedger(base)).toBeUndefined()
    expect(projectRollLedger({ ...base, participants: participants.slice(0, 2), state: state() })).toBeUndefined()
    expect(projectRollLedger({ ...base, state: state([{ ...records[0], fee: 41 }]) })).toBeUndefined()
    expect(projectRollLedger({ ...base, archivedRolls: [archived(records[0], 1)], archivedActions: [{ action: "roll_start", rollId: "absent" }] })).toBeUndefined()
  })
})

describe("真实牌桌响应费用账本", () => {
  it("启用Roll的新手在首次收费前返回已知空账本", async () => {
    const f = await rollStore()
    const view = await new PokerActionService(f.poker).state("u", f.room.code, "public", false, f.now)
    expect(view.rollLedger).toMatchObject({ handId: f.hands[0].id, status: "pending", entries: [] })
    expect(view.rollLedger?.players).toHaveLength(3)
  })
  it("所有视角和受众都有完整公开明细，选择不重复；同座新账号不继承旧身份", async () => {
    const f = await rollStore(), service = new PokerRollService(f.poker), actions = new PokerActionService(f.poker)
    const hand = f.hands[0], actor = f.seats.find(seat => seat.seatNo === hand.engineState.actionOnSeat)!
    const input = { roomCode: f.room.code, handId: hand.id, street: hand.engineState.street, expectedActionSeq: 0, controlVersion: 0, actionId: randomUUID(), kind: "super" as const, cardIndex: 0, expectedFee: quoteRoll(hand.engineState, actor.seatNo).super.fee }
    await service.start(actor.userId, input, f.now)
    await service.choose(actor.userId, { roomCode: f.room.code, handId: hand.id, rollId: input.actionId, candidateIndex: 0, expectedActionSeq: 1, controlVersion: 0, actionId: randomUUID() }, f.now)
    const originalName = f.participants.find(player => player.userId === actor.userId)!.displayName
    actor.userId = "fresh"; actor.displayName = "新玩家"
    for (const perspective of ["owner", "public"] as const) for (const audience of ["decision", "desktop"] as const) {
      const view = await actions.state("fresh", f.room.code, perspective, false, f.now, audience)
      expect(view.rollLedger?.entries).toHaveLength(1)
      expect(view.rollLedger?.entries[0].fee).toBe(input.expectedFee)
      expect(view.rollLedger?.players.find(player => player.seatNo === actor.seatNo)).toMatchObject({ displayName: originalName, isMe: false })
    }
  })
  it("正常结算与JSON归档后返回相同完整账本，取消陪练手返回cancelled", async () => {
    const f = await rollStore(), hand = f.hands[0], service = new PokerRollService(f.poker), actions = new PokerActionService(f.poker)
    const seat = f.seats.find(player => player.seatNo === hand.engineState.actionOnSeat)!
    await service.start(seat.userId, { roomCode: f.room.code, handId: hand.id, street: hand.engineState.street, expectedActionSeq: 0, controlVersion: 0, actionId: randomUUID(), kind: "normal", cardIndex: 0, expectedFee: quoteRoll(hand.engineState, seat.seatNo).normal.fee }, f.now)
    let engineState = hand.engineState
    while (engineState.street !== "settled") engineState = act(engineState, engineState.actionOnSeat, { action: "fold" })
    await f.transact(context => saveHand(f.poker, context, hand, engineState))
    const hot = await actions.state("u", f.room.code, "public", false, f.now)
    expect(hot.rollLedger).toMatchObject({ status: "released", entries: [expect.any(Object)] })
    const { engineState: _engine, ...storedHand } = f.hands[0]
    f.archives.push(JSON.parse(JSON.stringify({ roomId: f.room.id, handNo: hand.handNo, data: { hand: storedHand, seats: f.participants, actions: f.actions, rolls: f.rolls, summaries: f.summaries } })))
    f.hands.splice(0)
    const cold = await actions.state("u", f.room.code, "public", false, f.now)
    expect(cold.rollLedger).toEqual(hot.rollLedger)

    const practice = await rollStore("practice", 2), practiceHand = practice.hands[0]
    practice.seats[1].participantKind = "bot"; practice.participants[1].participantKind = "bot"
    await new PokerRollService(practice.poker).start("u", { roomCode: practice.room.code, handId: practiceHand.id, street: practiceHand.engineState.street, expectedActionSeq: 0, controlVersion: 0, actionId: randomUUID(), kind: "super", cardIndex: 0, expectedFee: quoteRoll(practiceHand.engineState, 0).super.fee }, practice.now)
    await practice.poker.close("u", practice.room.code, practice.now)
    const cancelled = await new PokerActionService(practice.poker).state("u", practice.room.code, "public", false, practice.now)
    expect(cancelled.rollLedger).toMatchObject({ status: "cancelled", entries: [expect.any(Object)] })
  })
})
