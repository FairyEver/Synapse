import { describe, expect, it } from "vitest"
import { projectHandLog } from "../poker-hand-log"
import { rollStore } from "./roll-service-store"
import { PokerActionService } from "../poker-action.service"
import { PokerRollService } from "../poker-roll.service"
import { quoteRoll } from "../engine/hand-runner"
import { randomUUID } from "node:crypto"

const participants = [0, 1, 2].map(seatNo => ({ handId: "h", seatNo, userId: `u${seatNo}`, displayName: `原玩家${seatNo}`, startingStack: seatNo === 1 ? 1 : 500 }))
const hand = { id: "h", status: "running", dealerSeat: 0, rules: { variant: "standard52", smallBlind: 5, bigBlind: 10 }, actionSeq: 3 }
const actions = [
  { handId: "h", roomId: "room", seq: 1, seatNo: 0, userId: "u0", street: "preflop", action: "roll_start", amount: 0, rollId: "r1", isAuto: false, actionSource: "human", note: "私密判断" },
  { handId: "h", roomId: "room", seq: 2, seatNo: 0, userId: "u0", street: "preflop", action: "roll_choose", amount: 0, rollId: "r1", isAuto: false, actionSource: "human" },
  { handId: "h", roomId: "room", seq: 3, seatNo: 0, userId: "u0", street: "preflop", action: "call", amount: 10, isAuto: false, actionSource: "human" },
]
const rolls = [{ id: "r1", seatNo: 0, kind: "super", fee: 40, count: 1, selectedIndex: 0, oldCard: "As", candidates: ["Ks"], cardIndex: 0 }]
const input = { roomId: "room", hand, participants, actions, rolls, pendingRollId: null }
describe("本手公开行动日志", () => {
  it("新资金规则允许零实付Roll，出牌仅显示实际施放身份", () => {
    const funded = { ...hand, rules: { ...hand.rules, chipRulesVersion: "chips-v2" } }
    const paid = projectHandLog({ ...input, hand: funded, rolls: [{ ...rolls[0], fee: 0 }] })
    expect(paid?.entries[2]).toMatchObject({ action: "roll", amount: 0 })
    const cardAction = { ...actions[2], seq: 1, action: "card_play", amount: 0 }
    const log = projectHandLog({ ...input, hand: { ...funded, actionSeq: 1 }, actions: [cardAction], cards: [{ cardId: "24", seq: 1, status: "completed" }] })
    expect(log?.entries.at(-1)).toMatchObject({ action: "card", card: { id: "24", name: "弃旧图新" } })
  })
  it("五选一公开能力牌和实付费用，不公开候选或暗牌，也不重复记录选择", () => {
    const actionsV2 = [
      { ...actions[0], action: "card_play", rollId: null, amount: 24 },
      { ...actions[1], action: "card_choose", rollId: null, amount: 0 },
    ]
    const log = projectHandLog({ ...input, hand: { ...hand, rules: { ...hand.rules, cardRulesVersion: "cards-v2", chipRulesVersion: "chips-v2", ruleOptions: { cards: true } }, actionSeq: 2 },
      actions: actionsV2, cards: [{ cardId: "07", seq: 1, status: "completed", paidAmount: 24,
        ...{ candidates: ["Ks"], targetHole: "As", ownerAdmissionId: "private-id" } }],
    })
    expect(log?.entries.slice(2)).toEqual([{
      seq: 1, seatNo: 0, displayName: "原玩家0", street: "preflop", action: "card", amount: 24, isAuto: false, actionSource: "human",
      card: { id: "07", artId: "v2/07", name: "五选其一", description: expect.any(String), status: "completed" },
    }])
    expect(JSON.stringify(log)).not.toMatch(/Ks|As|private-id|candidates|targetHole|ownerAdmissionId/)
  })
  it("实际短筹码盲注先行，下注和Roll按seq合并且choose不重复收费", () => {
    const log = projectHandLog(input)!
    expect(log.complete).toBe(true)
    expect(log.entries.map(e => [e.seq, e.action, e.amount])).toEqual([[-1, "small_blind", 1], [0, "big_blind", 10], [1, "roll", 40], [3, "call", 10]])
    expect(log.entries[2].roll).toEqual({ kind: "super", count: 1, status: "completed" })
    for (const key of ["userId", "roomId", "note", "oldCard", "candidates", "cardIndex", "selectedIndex"]) expect(JSON.stringify(log)).not.toContain(`"${key}"`)
  })
  it("尾部不完整不补盲注；身份错配或缺Roll源显式不可用", () => {
    expect(projectHandLog({ ...input, actions: actions.slice(1) })).toMatchObject({ complete: false, entries: [{ seq: 3, action: "call" }] })
    expect(projectHandLog({ ...input, actions: [{ ...actions[2], userId: "new-player" }] })).toBeUndefined()
    expect(projectHandLog({ ...input, rolls: [] })).toBeUndefined()
  })
  it("待选/重抽/取消保留收费事实，不把被替代的旧候选标成待选", () => {
    const unchosen = [{ ...rolls[0], selectedIndex: null }]
    expect(projectHandLog({ ...input, rolls: unchosen, pendingRollId: "r1" })!.entries[2].roll?.status).toBe("pending")
    expect(projectHandLog({ ...input, rolls: unchosen })!.entries[2].roll?.status).toBe("replaced")
    expect(projectHandLog({ ...input, hand: { ...hand, status: "cancelled" }, rolls: unchosen })!.entries[2].roll?.status).toBe("cancelled")
  })
  it("真实服务刷新仍有完整日志，同座新玩家不覆盖本手姓名", async () => {
    const f = await rollStore(), h = f.hands[0], actor = f.seats.find(s => s.seatNo === h.engineState.actionOnSeat)!
    await new PokerRollService(f.poker).start(actor.userId, { roomCode: f.room.code, handId: h.id, street: h.engineState.street, expectedActionSeq: 0, controlVersion: 0, actionId: randomUUID(), kind: "normal", cardIndex: 0, expectedFee: quoteRoll(h.engineState, actor.seatNo).normal.fee }, f.now)
    const name = actor.displayName; actor.displayName = "新占座者"; actor.userId = "fresh"
    const service = new PokerActionService(f.poker)
    const hot = await service.state("fresh", f.room.code, "public", false, f.now)
    expect(hot.handLog).toMatchObject({ complete: true, entries: [expect.any(Object), expect.any(Object), { action: "roll", displayName: name }] })
    const { engineState: _state, ...stored } = f.hands[0]
    f.archives.push(JSON.parse(JSON.stringify({ roomId: f.room.id, handNo: h.handNo, data: { hand: stored, seats: f.participants, actions: f.actions, rolls: f.rolls, summaries: f.summaries } })))
    f.hands.splice(0)
    expect((await service.state("fresh", f.room.code, "public", false, f.now)).handLog).toEqual(hot.handLog)
  })
  it("最多返回1000条尾部且标记不完整，不改变原最近30条普通行动", async () => {
    const f = await rollStore(), h = f.hands[0], actor = f.participants[0]
    h.actionSeq = 1001
    f.actions.push(...Array.from({ length: 1001 }, (_, i) => ({ id: `a${i}`, handId: h.id, roomId: f.room.id,
      userId: actor.userId, seq: i + 1, seatNo: actor.seatNo, street: "preflop", action: "check", amount: 0,
      potAfter: 3, isAuto: false, actionSource: "human" })))
    const view = await new PokerActionService(f.poker).state("u", f.room.code, "public", false, f.now)
    expect(view.handLog?.complete).toBe(false)
    expect(view.handLog?.entries).toHaveLength(1000)
    expect(view.handLog?.entries[0].seq).toBe(2)
    expect(view.recentActions).toHaveLength(30)
    expect(view.recentActions[0].seq).toBe(972)
  })
})
