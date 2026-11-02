import { describe, expect, it } from "vitest"
import { z } from "zod"
import { registerCardStatusOperations, paymentModifiers, cardSurcharges } from "../cards/statuses"
import { registerPokerCardOperations } from "../cards/poker-operations"
import { OperationRegistry } from "../cards/registry"
import { runResolution } from "../cards/runner"
import type { HandState } from "../hand-runner"
import type { DomainOperation, EffectInstance } from "../cards/types"
import { applyCardPoolOperation } from "../cards/pool"
import { cardContext, makeCardHand } from "../../__tests__/card-test-fixtures"

function effect(kind: string, owner = 1, extra: Partial<EffectInstance> = {}): EffectInstance {
  return { id: `${kind}-${owner}`, kind, cardId: "test", ownerAdmissionId: `admission-${owner}`, ownerSeatNo: owner, targetSeatNo: owner, polarity: "positive", installedSeq: 0, remaining: 1, dispellable: true, data: {}, ...extra }
}
function run(h: HandState, operations: DomainOperation[], seq = 1, nowMs = 0) {
  const registry = new OperationRegistry<HandState>({ effects: s => s.cards!.effects })
  registerPokerCardOperations(registry); registerCardStatusOperations(registry)
  registry.register({ id: "ability.draw", schema: z.object({ admissionId: z.string(), count: z.number(), reason: z.string() }), apply(s, input, api) {
    s.cards = applyCardPoolOperation(s.cards!, { kind: "draw", admissionId: input.admissionId, count: input.count }, api.context).state
  } })
  return runResolution(h, operations, cardContext({ actionSeq: seq, nowMs }), registry)
}
const op = (type: string, input: Record<string, unknown>): DomainOperation => ({ type, input, cardId: "test" })
describe("持续状态", () => {
  it("shield_first_effect_only：只消费第一个有效改牌护盾", () => {
    const h = makeCardHand(); h.cards!.effects = [effect("hole_guard"), effect("hole_guard", 1, { id: "second", installedSeq: 1 })]
    const next = run(h, [op("poker.exchange", { seatNo: 0, targetSeatNo: 1, cardIndex: 0 })]).state
    expect(next.seats.map(p => p.hole)).toEqual(h.seats.map(p => p.hole))
    expect(next.cards!.effects.map(e => e.id)).toEqual(["second"])
  })
  it("dispel_polarity：驱散他人增益触发反制，帮助解除负面不触发", () => {
    const h = makeCardHand(); h.cards!.effects = [effect("hole_guard"), effect("counter")]
    const blocked = run(h, [op("ability.dispel", { effectId: "hole_guard-1" })]).state
    expect(blocked.cards!.effects.map(e => e.kind)).toEqual(["hole_guard"])
    h.cards!.effects = [effect("surcharge", 1, { polarity: "negative" }), effect("counter")]
    const helped = run(h, [op("ability.dispel", { effectId: "surcharge-1" })]).state
    expect(helped.cards!.effects.map(e => e.kind)).toEqual(["counter"])
  })
  it("cleanse_public_child_not_knowledge：净化实体子标记且父状态不重挂，46免追加卡费", () => {
    const h = makeCardHand(), card = h.seats[0].hole[0]
    h.cards!.effects = [effect("reveal_field", 0, { id: "parent", targetSeatNo: undefined, polarity: "neutral", remaining: null }), effect("surcharge", 0, { polarity: "negative", data: { amount: 4 } })]
    h.cards!.publicMarkers = [{ id: "child", card, cardId: "60", ownerAdmissionId: "admission-1", parentEffectId: "parent", dispellable: true }]
    h.cards!.privateResults.push({ id: "seen", cardId: "13", ownerAdmissionId: "admission-1", label: "one", values: [card], valid: true })
    expect(cardSurcharges(h, 0, true)).toEqual({ amount: 0, effectIds: [] })
    const next = run(h, [op("ability.dispel", { effectId: "child", cleanse: true })]).state
    expect(next.cards!.publicMarkers).toEqual([]); expect(next.cards!.effects).toHaveLength(2)
    expect(next.cards!.privateResults[0].values).toEqual([card])
  })
  it("47反窥可被43拦截且不反射成环", () => {
    const h = makeCardHand(); h.cards!.effects = [effect("reflect"), effect("info_guard", 0)]
    const next = run(h, [op("poker.peek", { seatNo: 1, mode: "one" })]).state
    expect(next.cards!.privateResults).toEqual([]); expect(next.cards!.effects).toEqual([])
    h.cards!.effects = [effect("reflect"), effect("reflect", 0)]
    const reflected = run(h, [op("poker.peek", { seatNo: 1, mode: "one" })]).state
    expect(reflected.cards!.privateResults).toHaveLength(1)
    expect(reflected.cards!.privateResults[0]).toMatchObject({ ownerAdmissionId: "admission-1", values: [h.seats[0].hole[0]] })
    expect(reflected.cards!.effects.map(e => e.ownerSeatNo)).toEqual([0])
  })
  it("群体不是单目标，护盾只排除其拥有者；全局状态不随来源弃牌消失", () => {
    const h = makeCardHand({ humans: 3 }); h.cards!.effects = [effect("counter"), effect("hole_guard", 2)]
    const next = run(h, [op("poker.shuffleHoles", {})]).state
    expect(next.cards!.effects.map(e => e.kind)).toEqual(["counter"])
    expect(next.seats[2].hole).toEqual(h.seats[2].hole)
    next.seats[0].folded = true
    const field = run(next, [op("ability.install", { kind: "tide_field", polarity: "neutral", field: true, expiresStreet: true })]).state
    expect(field.cards!.effects.some(e => e.kind === "tide_field")).toBe(true)
  })
  it("阶段潮汐换新不清首次记录；派生抽牌不增强57自身", () => {
    let h = makeCardHand()
    h = run(h, [op("ability.install", { kind: "tide_field", polarity: "neutral", field: true, expiresStreet: true })]).state
    h = run(h, [op("ability.played", { admissionId: "admission-0", seatNo: 0 })], 2).state
    expect(h.cards!.hands["admission-0"]).toHaveLength(1)
    h = run(h, [op("ability.install", { kind: "tide_field", polarity: "neutral", field: true, expiresStreet: true })], 3).state
    h = run(h, [op("ability.played", { admissionId: "admission-0", seatNo: 0 })], 4).state
    expect(h.cards!.hands["admission-0"]).toHaveLength(1)
    h.cards!.effects = [effect("double_draw", 0)]
    h = run(h, [op("ability.draw", { admissionId: "admission-0", count: 1, reason: "card" })], 5).state
    expect(h.cards!.hands["admission-0"]).toHaveLength(3); expect(h.cards!.effects).toEqual([])
    h.cards!.effects = [effect("double_draw", 0)]
    h = run(h, [op("ability.draw", { admissionId: "admission-0", count: 1, reason: "trigger" })], 6).state
    expect(h.cards!.hands["admission-0"]).toHaveLength(4); expect(h.cards!.effects).toHaveLength(1)
  })
  it("65个状态原子拒绝；豁免按安装顺序读取，清理不恢复已全下", () => {
    const h = makeCardHand(); h.cards!.effects = Array.from({ length: 64 }, (_, i) => effect("waiver", 0, { id: String(i), data: { cap: 6 } }))
    expect(paymentModifiers(h, 0)).toHaveLength(64)
    expect(() => run(h, [op("ability.install", { kind: "waiver", polarity: "positive", data: { cap: 20 } })])).toThrow("POKER_CARD_BUDGET_EXCEEDED")
    expect(h.cards!.effects).toHaveLength(64)
    h.seats[1].allIn = true
    const next = run(h, [op("ability.clearStatuses", {})]).state
    expect(next.cards!.effects).toEqual([]); expect(next.seats[1].allIn).toBe(true)
  })
  it("缩时只作用下回合，期限内驱散返还实际缩短量；缓流驱散不撤销已确定加时", () => {
    let h = makeCardHand()
    h = run(h, [op("ability.install", { kind: "shrink", targetSeatNo: 1, polarity: "negative" }), op("ability.install", { kind: "slow_field", polarity: "neutral", field: true, expiresStreet: true })]).state
    h = run(h, [op("ability.turnStarted", { seatNo: 1, turnId: "t" })], 2).state
    expect(h.turnClock!.deadlineAt).toBe(360000)
    const slowId = h.cards!.effects.find(e => e.kind === "shrink")!.id, fieldId = h.cards!.effects.find(e => e.kind === "slow_field")!.id
    h = run(h, [op("ability.dispel", { effectId: slowId }), op("ability.dispel", { effectId: fieldId })], 3, 100000).state
    expect(h.turnClock).toMatchObject({ startedAt: 0, deadlineAt: 660000 })
  })
})
