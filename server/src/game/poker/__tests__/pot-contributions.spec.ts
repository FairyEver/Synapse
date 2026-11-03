import { randomUUID } from "node:crypto"
import { projectPotContributions } from "../poker-pot-contributions"
import { act, quoteRoll, startHand } from "../engine/hand-runner"
import { orderedDeck } from "../engine/deck"
import { PokerRollService } from "../poker-roll.service"
import { describe, expect, it } from "vitest"
import { PokerActionService } from "../poker-action.service"
import { rollStore } from "./roll-service-store"

describe("真实牌桌底池来源投影", () => {
  it("暂存所得可继续投入，新规则允许真实累计超过本人最初带入", () => {
    const h = startHand([{ seatNo: 0, stack: 500 }, { seatNo: 1, stack: 500 }], 0, orderedDeck())
    h.seats[0].total = 600
    const players = h.seats.map(s => ({ handId: "h", seatNo: s.seatNo, userId: `u${s.seatNo}`, admissionId: `a${s.seatNo}`, displayName: "玩家", folded: false, startingStack: 500 }))
    const input = { roomId: "r", userId: "u0", hand: { id: "h", status: "running", dealerSeat: 0, rules: {}, actionSeq: 0 }, participants: players, state: h }
    expect(projectPotContributions(input)).toBeUndefined()
    h.chipRulesVersion = "chips-v2"
    expect(projectPotContributions(input)?.players[0].amount).toBe(600)
  })
  it("普通非Roll新手在下注前向所有视角/受众返回实际盲注及原参与身份", async () => {
    const f = await rollStore("points", 3, { ruleOptions: {}, rollPricingVersion: null })
    const actions = new PokerActionService(f.poker)
    for (const perspective of ["owner", "public"] as const) for (const audience of ["desktop", "decision"] as const) {
      const view = await actions.state("u", f.room.code, perspective, false, f.now, audience)
      expect(view.potContributions).toMatchObject({ handId: f.hands[0].id, status: "pending", total: 3 })
      expect(view.potContributions?.players.map(player => player.amount).sort()).toEqual([0, 1, 2])
    }
  })
})

const participants = [0, 1, 2].map(seatNo => ({ handId: "hand", seatNo, userId: `user-${seatNo}`, admissionId: `admission-${seatNo}`, displayName: `原玩家${seatNo}`, folded: false, startingStack: 500 }))
const hand = { id: "hand", status: "running", dealerSeat: 0, rules: { variant: "standard52", smallBlind: 1, bigBlind: 2 }, actionSeq: 0 }
const base = { roomId: "room", userId: "user-0", hand, participants }
const state = () => startHand(participants.map(p => ({ seatNo: p.seatNo, stack: p.startingStack })), 0, orderedDeck())
const action = (seq: number, seatNo: number, amount: number, kind = "call") => ({ handId: "hand", roomId: "room", userId: `user-${seatNo}`, seq, seatNo, amount, action: kind })

describe("本手累计底池来源", () => {
  it("短筹码按实际盲注，没投入的参与者保留零", () => {
    const short = participants.map(p => ({ ...p, startingStack: p.seatNo === 0 ? 100 : 1 }))
    const engine = startHand(short.map(p => ({ seatNo: p.seatNo, stack: p.startingStack })), 0, orderedDeck())
    const hot = projectPotContributions({ ...base, participants: short, state: engine })!
    const cold = projectPotContributions({ ...base, participants: short, archivedActions: [] })!
    expect(hot.players.map(player => player.amount)).toEqual([0, 1, 1])
    expect(hot.total).toBe(2)
    expect(cold).toEqual(hot)
  })
  it("完整归档超过30动作，不依赖近期列表；Roll start/choose不混入", () => {
    const actions = Array.from({ length: 45 }, (_, i) => action(i + 1, i % 3, 1))
    actions.push(action(46, 0, 0, "roll_start"), action(47, 0, 0, "roll_choose"))
    const cold = projectPotContributions({ ...base, hand: { ...hand, actionSeq: 47 }, archivedActions: actions.reverse() })!
    expect(cold.total).toBe(48)
    expect(cold.players.map(player => player.amount)).toEqual([15, 16, 17])
    const engine = state()
    engine.seats.forEach((seat, i) => { seat.total += 15; seat.folded = i === 1 })
    const hot = projectPotContributions({ ...base, state: engine })!
    expect(hot.total).toBe(cold.total)
    expect(hot.players[1]).toMatchObject({ folded: true, amount: 16 })
  })
  it.each(["cards-v2", "cards-v3"])("%s 新版卡费入主池，但实时与归档的普通下注来源均不计入卡费", cardRulesVersion => {
    const rules = { ...hand.rules, cardRulesVersion, chipRulesVersion: "chips-v2", ruleOptions: { cards: true } }
    const input = { ...base, hand: { ...hand, rules, actionSeq: 3 } }
    const engine = state()
    engine.seats[0].total = 2
    const hot = projectPotContributions({ ...input, state: engine })
    const cold = projectPotContributions({ ...input, archivedActions: [action(1, 0, 8, "card_play"), action(2, 0, 0, "card_choose"), action(3, 0, 2)] })
    expect(hot?.total).toBe(5)
    expect(cold).toEqual(hot)
  })
  it("结算含未跟注退款和边池的全部投入，不把已归零的hand.pot当来源", () => {
    const players = [200, 50, 100].map((startingStack, seatNo) => ({ ...participants[seatNo], startingStack }))
    let engine = startHand(players.map(p => ({ seatNo: p.seatNo, stack: p.startingStack })), 0, orderedDeck())
    const actions = []
    while (engine.street !== "settled") {
      const seatNo = engine.actionOnSeat!, before = engine.seats.find(p => p.seatNo === seatNo)!.total
      engine = act(engine, seatNo, { action: "allin" })
      actions.push(action(actions.length + 1, seatNo, engine.seats.find(p => p.seatNo === seatNo)!.total - before, "allin"))
    }
    expect(engine.pots.some(pot => pot.refund)).toBe(true)
    expect(engine.pots).toHaveLength(3)
    const settled = { ...hand, status: "settled", actionSeq: actions.length }
    const hot = projectPotContributions({ ...base, hand: settled, participants: players, state: engine })!
    const cold = projectPotContributions({ ...base, hand: settled, participants: players, archivedActions: actions })!
    expect(hot).toMatchObject({ status: "settled", total: 350 })
    expect(hot.players.map(p => p.amount)).toEqual([200, 50, 100])
    expect(cold).toEqual(hot)
  })
  it("身份只取原本手快照，公开白名单无账号/入座ID、底牌或私密note", () => {
    const hot = projectPotContributions({ ...base, state: state() })!
    const fresh = projectPotContributions({ ...base, userId: "fresh", state: state() })!
    expect(fresh.players.map(p => p.isMe)).toEqual([false, false, false])
    expect(hot.players[0].isMe).toBe(true)
    expect(hot.players[0].key).toMatch(/^[a-f0-9]{64}$/)
    expect(projectPotContributions({ ...base, roomId: "another", state: state() })?.players[0].key).not.toBe(hot.players[0].key)
    expect(Object.keys(hot).sort()).toEqual(["handId", "players", "status", "total"])
    expect(Object.keys(hot.players[0]).sort()).toEqual(["amount", "displayName", "folded", "isMe", "key", "seatNo"])
    expect(JSON.stringify(hot)).not.toMatch(/user-0|admission-|hole|note|candidates/)
  })
  it("取消手仍保留投入并明确cancelled，缺源和损坏不返回虚假的完整零", () => {
    expect(projectPotContributions({ ...base, hand: { ...hand, status: "cancelled" }, state: state() })).toMatchObject({ status: "cancelled", total: 3 })
    expect(projectPotContributions(base)).toBeUndefined()
    expect(projectPotContributions({ ...base, participants: [], state: state() })).toBeUndefined()
    const corrupt = state(); corrupt.seats[0].total = 0.5
    expect(projectPotContributions({ ...base, state: corrupt })).toBeUndefined()
    const zero = state(); zero.seats.forEach(seat => { seat.total = 0 })
    expect(projectPotContributions({ ...base, state: zero })).toBeUndefined()
    expect(projectPotContributions({ ...base, participants: [null, ...participants.slice(1)] as any, state: state() })).toBeUndefined()
    expect(projectPotContributions({ ...base, hand: { ...hand, actionSeq: 1 }, archivedActions: [null] as any })).toBeUndefined()
    const missing = state(); missing.seats.pop()
    expect(projectPotContributions({ ...base, state: missing })).toBeUndefined()
    expect(projectPotContributions({ ...base, hand: { ...hand, actionSeq: 1 }, archivedActions: [] })).toBeUndefined()
    for (const changed of [{ userId: "fresh" }, { amount: -1 }, { amount: 0.1 }, { seq: 2 }, { action: "unknown" }])
      expect(projectPotContributions({ ...base, hand: { ...hand, actionSeq: 1 }, archivedActions: [{ ...action(1, 0, 3), ...changed }] })).toBeUndefined()
  })
})

describe("实际热冷牌桌来源一致", () => {
  it("Roll与普通下注独立，同座换人仍保留旧姓名和金额；JSON归档与结算前后一致", async () => {
    const f = await rollStore(), hand = f.hands[0], views = new PokerActionService(f.poker)
    const actor = f.seats.find(seat => seat.seatNo === hand.engineState.actionOnSeat)!
    const fee = quoteRoll(hand.engineState, actor.seatNo).normal.fee
    await new PokerRollService(f.poker).start(actor.userId, { roomCode: f.room.code, handId: hand.id, street: hand.engineState.street, expectedActionSeq: 0, controlVersion: 0, actionId: randomUUID(), kind: "normal", cardIndex: 0, expectedFee: fee }, f.now)
    expect((await views.state("u", f.room.code, "public", false, f.now)).potContributions?.total).toBe(3)
    while (hand.engineState.street !== "settled") {
      const seat = f.seats.find(seat => seat.seatNo === hand.engineState.actionOnSeat)!
      await views.act(seat.userId, f.room.code, { handId: hand.id, street: hand.engineState.street, action: "fold", actionId: randomUUID(), controlVersion: 0, expectedActionSeq: hand.actionSeq }, f.now)
    }
    const oldName = f.participants.find(p => p.seatNo === actor.seatNo).displayName
    actor.userId = "fresh"; actor.displayName = "新玩家"; actor.id = "fresh-admission"
    const hot = await views.state("fresh", f.room.code, "public", false, f.now)
    expect(hot.pot).toBe(0)
    expect(hot.potContributions).toMatchObject({ status: "settled", total: 3 })
    expect(hot.potContributions?.players.find(p => p.seatNo === actor.seatNo)).toMatchObject({ displayName: oldName, isMe: false })
    const { engineState: _engine, ...storedHand } = hand
    f.archives.push(JSON.parse(JSON.stringify({ roomId: f.room.id, handNo: hand.handNo, data: { hand: storedHand, seats: f.participants, actions: f.actions, rolls: f.rolls, summaries: f.summaries } })))
    f.hands.splice(0)
    expect((await views.state("fresh", f.room.code, "public", false, f.now)).potContributions).toEqual(hot.potContributions)
  })
  it("关闭陪练手保留取消投入而不声称已到账", async () => {
    const f = await rollStore("practice", 2)
    f.seats[1].participantKind = "bot"; f.participants[1].participantKind = "bot"
    await f.poker.close("u", f.room.code, f.now)
    const view = await new PokerActionService(f.poker).state("u", f.room.code, "public", false, f.now)
    expect(view.potContributions).toMatchObject({ status: "cancelled", total: 3 })
  })
})
