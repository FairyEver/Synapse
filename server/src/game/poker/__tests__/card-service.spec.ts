import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { PokerCardService } from "../poker-card.service"
import { PokerActionService } from "../poker-action.service"
import { PokerRollService } from "../poker-roll.service"
import { quoteRoll } from "../engine/hand-runner"
import { rollStore } from "./roll-service-store"
import { quoteCardPlay } from "../engine/cards/commands"
import { createCardRegistry } from "../engine/cards/catalog-v1"
import type { PokerCardPlayInput } from "@synapse/shared/game-contracts"
import type { HandState } from "../engine/hand-runner"
import * as botPolicy from "../bot-policy"
import * as botRollPolicy from "../bot-roll-policy"

async function fixture() { return rollStore("points", 2, { ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" }) }
function request(f: Awaited<ReturnType<typeof fixture>>, definitionId = "59", selections: Record<string, string | number> = {}): PokerCardPlayInput {
  const hand = f.hands[0], h = hand.engineState as HandState, actor = h.participants!.find(p => p.seatNo === h.actionOnSeat)!, own = h.cards!.hands[actor.admissionId]
  let instance = own.find(c => c.definitionId === definitionId)
  if (!instance) for (const zone of [h.cards!.pool, ...Object.entries(h.cards!.hands).filter(([id]) => id !== actor.admissionId).map(([, cards]) => cards)]) {
    const index = zone.findIndex(c => c.definitionId === definitionId)
    if (index >= 0) { instance = zone.splice(index, 1)[0]; own.push(instance); break }
  }
  if (!instance) throw new Error("fixture card not found")
  const input: PokerCardPlayInput = { roomCode: f.room.code, handId: hand.id, street: h.street as "preflop", expectedActionSeq: hand.actionSeq, controlVersion: 0, actionId: randomUUID(), instanceId: instance.id, selections, expectedPaymentVersion: "" }
  input.expectedPaymentVersion = quoteCardPlay(h, input, createCardRegistry()).version
  return input
}
describe("卡牌房间原子服务", () => {
  it("卡牌陪练机器人不持卡，仍能用锁内真实报价完成正额跟注", async () => {
    const f = await rollStore("practice", 1, { ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" }, { bots: 1 })
    const actions = new PokerActionService(f.poker), view = await actions.state("u", f.room.code, "owner", false, f.now, "desktop")
    await actions.act("u", f.room.code, { handId: view.handId!, street: "preflop", expectedActionSeq: view.actionSeq, controlVersion: view.controlVersion, actionId: randomUUID(), action: "raise", to: 4, expectedPaymentVersion: view.paymentVersion }, f.now, "human")
    const h = f.hands[0].engineState as HandState, bot = h.participants!.find(p => p.kind === "bot")!, stack = h.seats.find(s => s.seatNo === bot.seatNo)!.stack
    const roll = vi.spyOn(botRollPolicy, "chooseBotRoll").mockReturnValue(null), decision = vi.spyOn(botPolicy, "chooseBotAction").mockReturnValue({ action: "call" })
    try { await actions.actBot(f.room.code, { handId: f.hands[0].id, scheduledAt: f.room.botActionAt! }, new Date(f.room.botActionAt!)) }
    finally { roll.mockRestore(); decision.mockRestore() }
    const next = f.hands[0].engineState as HandState
    expect(next.seats.find(s => s.seatNo === bot.seatNo)!.stack).toBe(stack - 2)
    expect(next.cards!.hands[bot.admissionId] ?? []).toEqual([])
    expect(f.actions.at(-1)).toMatchObject({ action: "call", actionSource: "rules_bot", amount: 2 })
  })
  it("本人下注预演返回豁免额度，公开投影不返回报价", async () => {
    const f = await fixture()
    await new PokerCardService(f.poker).play("u", request(f, "31"), "human", f.now)
    const actions = new PokerActionService(f.poker), own = await actions.state("u", f.room.code, "owner", false, f.now, "desktop")
    expect(own.betWaiverCap).toBe(20)
    const publicView = await actions.state("u", f.room.code, "public", false, f.now, "desktop")
    expect(publicView).not.toHaveProperty("betWaiverCap")
  })
  it("公开标记跟随实体牌换到新玩家，只公开指定槽位，净化不删原使用历史", async () => {
    const f = await fixture(), h = f.hands[0].engineState as HandState, card = h.seats[0].hole[0]
    h.cards!.publicMarkers = [{ id: "marker", card, cardId: "15", ownerAdmissionId: "admission-0", dispellable: true, expiresStreet: "preflop" }]
    const service = new PokerActionService(f.poker)
    let view = await service.state("outsider", f.room.code, "public", false, f.now, "decision")
    expect(view.seats[0].publicHole).toEqual([{ index: 0, card }]); expect(view.seats[0]).not.toHaveProperty("hole")
    ;[h.seats[0].hole[0], h.seats[1].hole[1]] = [h.seats[1].hole[1], h.seats[0].hole[0]]
    view = await service.state("outsider", f.room.code, "public", false, f.now, "decision")
    expect(view.seats[1].publicHole).toEqual([{ index: 1, card }]); expect(view.seats[0].publicHole ?? []).toEqual([])
    h.cards!.publicMarkers = []
    view = await service.state("outsider", f.room.code, "public", false, f.now, "decision")
    expect(view.seats.every(s => !s.publicHole?.length)).toBe(true)
  })
  it("超级Roll待选拦截所有主动卡牌，并允许原槽重抽；MCP读取保持公开", async () => {
    const f = await fixture(), rolls = new PokerRollService(f.poker)
    const start = (slot: number) => {
      const hand = f.hands[0], quote = quoteRoll(hand.engineState, 0)
      return rolls.start("u", { roomCode: f.room.code, handId: hand.id, street: "preflop", kind: "super", cardIndex: slot, expectedFee: quote.super.fee, expectedPaymentVersion: quote.super.payment!.version, actionId: randomUUID(), expectedActionSeq: hand.actionSeq, controlVersion: 0 }, f.now, "human")
    }
    await start(0)
    for (const id of ["03", "58", "51"]) await expect(new PokerCardService(f.poker).play("u", request(f, id, id === "03" ? { hole: 0 } : {}), "human", f.now)).rejects.toThrow()
    await expect(start(1)).rejects.toThrow(); expect(f.hands[0].actionSeq).toBe(1)
    await start(0)
    expect(f.hands[0].actionSeq).toBe(2); expect(f.hands[0].engineState.roll.counts[0]).toBe(2)
    const view = await new PokerActionService(f.poker).state("u", f.room.code, "owner", false, f.now, "decision")
    expect(view.cards).not.toHaveProperty("ownHand"); expect(view.cards).not.toHaveProperty("privateResults")
    expect(view.roll).not.toHaveProperty("pending"); expect(view.seats.every(s => !s.hole)).toBe(true)
  })
  it("单人陪练取消先收回候选并清理卡牌，暂存作废且不为机器人创建账户", async () => {
    const f = await rollStore("practice", 1, { ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" }, { bots: 1 })
    const service = new PokerCardService(f.poker)
    expect(f.hands[0].engineState.cards.hands["bot-0"] ?? []).toEqual([])
    await service.play("u", request(f, "38"), "human", f.now)
    await service.play("u", request(f, "06", { hole: 0 }), "human", f.now)
    await f.poker.close("u", f.room.code, f.now)
    expect(f.hands[0].status).toBe("cancelled"); expect(f.hands[0].actionSeq).toBe(3)
    expect(f.hands[0].engineState.cards.pending).toBeNull(); expect(Object.values(f.hands[0].engineState.cards.hands).flat()).toEqual([])
    expect(f.db.transfers).toMatchObject([{ funding: "practice", amount: 4, status: "voided", releasedTo: "discard" }])
    expect([...f.db.accounts.keys()]).toEqual(["u"]); expect(f.seats).toEqual([])
  })
  it("超时选择第一候选并撤出，只增加一次根序号且清空运行态", async () => {
    const f = await fixture(), input = request(f, "06", { hole: 0 })
    await new PokerCardService(f.poker).play("u", input, "human", f.now)
    const first = f.hands[0].engineState.cards.pending.candidates[0]
    await new PokerActionService(f.poker).expire(f.room.code, new Date(f.room.actionDeadlineAt.getTime() + 90 * 86400000))
    const hand = f.hands[0]
    expect(hand.actionSeq).toBe(2); expect(hand.engineState.seats[0].hole[0]).toBe(first)
    expect(hand.engineState.cards.pending).toBeNull(); expect(Object.values(hand.engineState.cards.hands).flat()).toEqual([])
    expect(f.resolutions.filter(r => r.seq === 2)).toHaveLength(1)
    expect(f.actions.at(-1).elapsedMs).toBe(600000)
  })
  it("真实Roll服务保持钻石与次数，筹码全免时不冻结任何资金", async () => {
    const f = await fixture(), state = f.hands[0].engineState as HandState
    state.cards!.effects.push({ id: "waive", kind: "waiver", cardId: "31", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "positive", installedSeq: 0, remaining: 1, dispellable: true, data: { cap: 100 } })
    const quote = quoteRoll(state, 0), stack = state.seats[0].stack
    await new PokerRollService(f.poker).start("u", { roomCode: f.room.code, handId: f.hands[0].id, street: "preflop", kind: "normal", cardIndex: 0, expectedFee: quote.normal.fee, expectedPaymentVersion: quote.normal.payment!.version, actionId: randomUUID(), expectedActionSeq: 0, controlVersion: 0 }, f.now, "human")
    const next = f.hands[0].engineState as HandState
    expect(next.seats[0].stack).toBe(stack); expect(next.roll!.counts[0]).toBe(1); expect(next.roll!.paid[0]).toBe(0)
    expect(quoteRoll(next, 0).coins!.balance).toBe(quote.coins!.balance - 1)
    expect(f.db.transfers).toEqual([]); expect(f.db.reserveLots).toEqual([])
  })
  it("same_uuid_one_result：并发与未知结果重试只消费一次，AI不能读取真人回执", async () => {
    const f = await fixture(), input = request(f), service = new PokerCardService(f.poker)
    const [a, b] = await Promise.all([service.play("u", input, "human", f.now), service.play("u", input, "human", f.now)])
    expect(a).toEqual(b); expect(f.hands[0].actionSeq).toBe(1)
    expect(f.actions).toHaveLength(1); expect(f.receipts).toHaveLength(1); expect(f.resolutions.filter(r => r.seq === 1)).toHaveLength(1)
    expect(f.hands[0].engineState.cards.used).toHaveLength(1)
    expect(await new PokerCardService(f.poker).play("u", input, "human", new Date(f.now.getTime() + 900000))).toEqual(a)
    await expect(service.play("u", input, "mcp", f.now)).rejects.toThrow()
    await expect(service.play("u", { ...input, selections: { hole: 1 } }, "human", f.now)).rejects.toThrow()
  })
  it("账本写入失败，状态、钱包、帧、动作和回执共同回滚", async () => {
    const f = await fixture(), input = request(f, "38"), service = new PokerCardService(f.poker)
    const snapshot = () => structuredClone({ hands: f.hands, sessions: f.db.sessions, account: f.db.account, actions: f.actions, receipts: f.receipts, frames: f.resolutions, lots: f.db.reserveLots, claims: f.db.reserveClaims, moves: f.db.reserveMovements })
    const before = snapshot(); f.db.failures.reserveMovement = true
    await expect(service.play("u", input, "human", f.now)).rejects.toThrow("injected reserve write failure")
    expect(snapshot()).toEqual(before)
  })
  it("锁等待跨过截止时间会重新拒绝，不消费卡牌", async () => {
    const f = await fixture(), input = request(f), original = f.poker.lockFunds.bind(f.poker)
    vi.useFakeTimers(); vi.setSystemTime(f.now)
    const spy = vi.spyOn(f.poker, "lockFunds").mockImplementation(async (...args) => { await original(...args); vi.setSystemTime(f.room.actionDeadlineAt.getTime() + 1) })
    try {
      await expect(new PokerCardService(f.poker).play("u", input)).rejects.toThrow()
      expect(f.hands[0].actionSeq).toBe(0); expect(f.receipts).toEqual([])
    } finally { spy.mockRestore(); vi.useRealTimers() }
  })
  it("延时不重设起点，旧超时调度不能提前撤出", async () => {
    const f = await fixture(), input = request(f, "51"), initial = f.room.actionDeadlineAt.getTime(), start = f.room.actionStartedAt.getTime()
    await new PokerCardService(f.poker).play("u", input, "human", new Date(f.now.getTime() + 100000))
    expect(f.room.actionStartedAt.getTime()).toBe(start); expect(f.room.actionDeadlineAt.getTime()).toBe(start + 1100000)
    await new PokerActionService(f.poker).expire(f.room.code, new Date(initial + 1))
    expect(f.hands[0].actionSeq).toBe(1); expect(f.seats).toHaveLength(2)
  })
  it("结算在真实底池后固化暂存，活跃入座仅标到账，不重复增加inPlay", async () => {
    const f = await fixture(), input = request(f, "38")
    await new PokerCardService(f.poker).play("u", input, "human", f.now)
    expect(f.db.reserveLots[0].remainingAmount).toBe(4)
    await new PokerActionService(f.poker).act("u", f.room.code, { handId: input.handId, street: "preflop", actionId: randomUUID(), expectedActionSeq: 1, controlVersion: 0, action: "fold" }, f.now, "human")
    expect(f.hands[0].status).toBe("settled")
    expect(f.db.reserveClaims[0]).toMatchObject({ remainingAmount: 0, status: "finalized" })
    expect(f.db.transfers).toMatchObject([{ amount: 4, status: "released", releasedTo: "table" }])
    expect(f.db.sessions.map(s => s.inPlay).sort((a, b) => a - b)).toEqual([495, 505])
    expect((await f.hall.overview("u", f.now)).points.pending).toBe(0)
  })
})
