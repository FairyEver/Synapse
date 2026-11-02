import { describe, expect, it } from "vitest"
import { CARD_CATALOG_V1, CARD_CATALOG_V1_SNAPSHOT, createCardRegistry } from "../cards/catalog-v1"
import { createCardOperationRegistry, planCardPlay, planCardChoice, quoteCardPlay } from "../cards/commands"
import { runResolution } from "../cards/runner"
import { assertCardPoolIntegrity } from "../cards/pool"
import { assertHandIntegrity } from "../hand-runner"
import type { PokerCardPlayInput } from "@synapse/shared/game-contracts"
import { makeCardHand, cardContext, sequenceRandomInt } from "../../__tests__/card-test-fixtures"
import { applyReserveOperation } from "../chips/reserve"
import { CARD_SCENARIOS, reserveTotal } from "./card-catalog-scenarios"

function fixture(id: string) {
  const h = makeCardHand({ definitions: CARD_CATALOG_V1 })
  const give = (definitionId: string, admission = "admission-0") => {
    const index = h.cards!.pool.findIndex(c => c.definitionId === definitionId), card = h.cards!.pool.splice(index, 1)[0]
    ;(h.cards!.hands[admission] ??= []).push(card); return card.id
  }
  const instanceId = give(id), extra = ["24", "26", "29", "30"].includes(id) ? give("21") : undefined
  give("21", "admission-1")
  h.turnClock = { seatNo: 0, turnId: "turn", startedAt: 0, deadlineAt: 600000, reductions: {} }
  return { h, instanceId, extra }
}
const registry = () => createCardRegistry()
function prepare(id: string, selections: Record<string, string | number> = {}) {
  const f = fixture(id)
  const input: PokerCardPlayInput = { roomCode: "TEST", handId: "test-hand", street: "preflop", expectedActionSeq: 4, controlVersion: 1, actionId: "00000000-0000-4000-8000-000000000001", instanceId: f.instanceId, selections: { ...selections }, expectedPaymentVersion: "" }
  if (input.selections.ability === "extra") input.selections.ability = f.extra!
  return { ...f, input }
}
function play(f: ReturnType<typeof prepare>, nowMs = 100000) {
  f.input.expectedPaymentVersion = quoteCardPlay(f.h, f.input, registry()).version
  const ctx = cardContext({ actionSeq: 5, nowMs, rootActionId: "play" })
  return runResolution(f.h, planCardPlay(f.h, f.input, ctx, registry()), ctx, createCardOperationRegistry(registry()))
}
describe("首批60张声明", () => {
  it("稳定ID、唯一名称、60种90份和唯一2BB基础代价", () => {
    expect(CARD_CATALOG_V1.map(c => c.id)).toEqual(Array.from({ length: 60 }, (_, i) => String(i + 1).padStart(2, "0")))
    expect(new Set(CARD_CATALOG_V1.map(c => c.name)).size).toBe(60)
    expect(CARD_CATALOG_V1.reduce((n, c) => n + (c.copies ?? 1), 0)).toBe(90)
    expect(CARD_CATALOG_V1.filter(c => c.copies === 2)).toHaveLength(30)
    expect(CARD_CATALOG_V1.filter(c => c.costBB)).toMatchObject([{ id: "38", costBB: 2 }])
    expect(CARD_CATALOG_V1_SNAPSHOT.digest).toBe("1ea700d2ef4ca989ed87eb9c98c46bad87d07ffca64ff3c3b5e74ba9d556d57c")
    expect(CARD_SCENARIOS.map(s => s.definitionId)).toEqual(CARD_CATALOG_V1.map(c => c.id))
  })
  it.each(CARD_SCENARIOS)("$definitionId 执行真实效果", scenario => {
    const f = prepare(scenario.definitionId, scenario.input)
    if (scenario.initialState === "reserve") {
      f.h.reserve = { revision: 0, lots: [], claims: [], movements: [], finalized: false }
      const paid = applyReserveOperation(f.h.reserve, { kind: "deposit", payer: f.h.cards!.participants[0], recipients: [f.h.cards!.participants[1]], amount: 120, sourceId: "old", sourceType: "roll" }, cardContext({ rootActionId: "deposit", actionSeq: 1 }), [1, 0])
      f.h.reserve = paid.state; f.h.seats[0].stack -= 120
    }
    if (scenario.initialState === "dispel" || scenario.initialState === "cleanse") f.h.cards!.effects.push({ id: "existing", kind: scenario.initialState === "cleanse" ? "surcharge" : "waiver", cardId: "49", ownerAdmissionId: scenario.initialState === "cleanse" ? "admission-0" : "admission-1", ownerSeatNo: scenario.initialState === "cleanse" ? 0 : 1, targetSeatNo: scenario.initialState === "cleanse" ? 0 : 1, polarity: scenario.initialState === "cleanse" ? "negative" : "positive", installedSeq: 0, remaining: 1, dispellable: true, data: { cap: 6, amount: 4 } })
    const original = structuredClone(f.h), beforeStack = f.h.seats[0].stack, beforeReserve = reserveTotal(f.h)
    f.input.expectedPaymentVersion = quoteCardPlay(f.h, f.input, registry()).version
    const ctx = cardContext({ actionSeq: 5, nowMs: 100000, rootActionId: "play", randomInt: sequenceRandomInt(scenario.entropy) })
    const result = runResolution(f.h, planCardPlay(f.h, f.input, ctx, registry()), ctx, createCardOperationRegistry(registry())), h = result.state, expected = scenario.expectedStateDelta
    if (expected.hole) expect(h.seats[0].hole).toEqual(expected.hole)
    if (expected.handCount !== undefined) expect(h.cards!.hands["admission-0"]).toHaveLength(expected.handCount)
    if (expected.private) expect(h.cards!.privateResults.at(-1)?.values).toEqual(expected.private)
    if (expected.effect) {
      const effect = h.cards!.effects.find(e => e.kind === expected.effect)!
      expect(effect).toBeDefined()
      if (expected.remaining !== undefined) expect(effect.remaining).toBe(expected.remaining)
      if (expected.cap !== undefined) expect(effect.data.cap).toBe(expected.cap)
      if (expected.amount !== undefined) expect(effect.data.amount).toBe(expected.amount)
    }
    if (expected.pending) expect(h.cards!.pending).toMatchObject({ kind: expected.pending, paymentVersion: f.input.expectedPaymentVersion })
    if (expected.generated !== undefined) expect(h.cards!.generatedCount).toBe(expected.generated)
    if (expected.spent !== undefined) expect(h.cards!.spent).toHaveLength(expected.spent)
    if (expected.stackDelta !== undefined) expect(h.seats[0].stack - beforeStack).toBe(expected.stackDelta)
    if (expected.reserveDelta !== undefined) expect(reserveTotal(h) - beforeReserve).toBe(expected.reserveDelta)
    if (expected.markers !== undefined) expect(h.cards!.publicMarkers).toHaveLength(expected.markers)
    if (expected.deadline !== undefined) expect(h.turnClock!.deadlineAt).toBe(expected.deadline)
    if (scenario.initialState === "cleanse" || scenario.initialState === "dispel") expect(h.cards!.effects).toEqual([])
    for (const type of scenario.expectedPublic) expect(result.frame.events.some(e => e.type === type && e.audience === "public")).toBe(true)
    for (const value of scenario.expectedPrivate) expect(result.frame.events.some(e => e.audience === "owner" && (e.data.values as string[] | undefined)?.includes(value))).toBe(true)
    expect(h.cards!.used).toMatchObject([{ cardId: scenario.definitionId, seatNo: 0 }])
    assertCardPoolIntegrity(h.cards!); assertHandIntegrity(h); expect(f.h).toEqual(original)
  })
  it("25选择原实例归还未选，不能开始其他主动卡", () => {
    const f = prepare("25"), result = play(f), pending = result.state.cards!.pending!
    const first = result.state.cards!.reserved[0], others = result.state.cards!.reserved.slice(1)
    const ctx = cardContext({ actionSeq: 6, rootActionId: "choose" })
    const choice = { ...f.input, expectedActionSeq: 5, choiceId: pending.id, candidateIndex: 0 }
    const chosen = runResolution(result.state, planCardChoice(result.state, choice, ctx, registry()), ctx, createCardOperationRegistry(registry())).state
    expect(chosen.cards!.hands["admission-0"]).toContainEqual(first)
    for (const card of others) expect(chosen.cards!.pool).toContainEqual(card)
    const forbidden = prepare("59"); forbidden.h.cards!.pending = pending
    expect(() => play(forbidden)).toThrow("POKER_CARD_CHOICE_REQUIRED")
  })
  it("完全豁免卡费仍耗税和豁免，未知选择/失效报价无消耗", () => {
    const f = prepare("38")
    f.h.cards!.effects = [
      { id: "waive", kind: "waiver", cardId: "31", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "positive", remaining: 1, installedSeq: 0, dispellable: true, data: { cap: 6 } },
      { id: "tax", kind: "surcharge", cardId: "49", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "negative", remaining: 1, installedSeq: 1, dispellable: true, data: { amount: 4 } },
    ]
    const before = f.h.seats[0].stack, result = play(f)
    expect(result.state.seats[0].stack).toBe(before - 2); expect(result.state.cards!.effects).toEqual([])
    f.input.expectedPaymentVersion = "stale"
    expect(() => planCardPlay(f.h, f.input, cardContext({ actionSeq: 5, nowMs: 1 }), registry())).toThrow("POKER_CARD_PRICE_CHANGED")
    const unknown = prepare("01", { hole: 0, arbitrary: 1 })
    expect(() => play(unknown)).toThrow("POKER_CARD_INVALID_SELECTION")
  })
  it("28新实例入池后抽的仍可为旧牌；30独立生成并排除生成标签", () => {
    const seed = prepare("28"), seeded = play(seed).state
    const originalIds = seed.h.cards!.pool.map(c => c.id)
    expect(originalIds).toContain(seeded.cards!.hands["admission-0"][0].id)
    const renewed = play(prepare("30", { ability: "extra" })).state
    const generated = [...renewed.cards!.pool, ...Object.values(renewed.cards!.hands).flat()].filter(c => c.id.startsWith("play:"))
    expect(generated).toHaveLength(2); expect(new Set(generated.map(c => c.id)).size).toBe(2)
    expect(generated.map(c => c.definitionId)).toEqual(["01", "01"])
  })
  it("35锁定用牌之前的存款，不能把本次追加费当成最近一笔", () => {
    const f = prepare("35")
    const paid = applyReserveOperation({ revision: 0, lots: [], claims: [], movements: [], finalized: false }, { kind: "deposit", payer: f.h.cards!.participants[0], recipients: [f.h.cards!.participants[1]], amount: 120, sourceId: "old", sourceType: "roll" }, cardContext({ rootActionId: "old", actionSeq: 1 }), [1, 0])
    f.h.reserve = paid.state; f.h.seats[0].stack -= 120
    f.h.cards!.effects.push({ id: "tax", kind: "surcharge", cardId: "49", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "negative", remaining: 1, installedSeq: 0, dispellable: true, data: { amount: 4 } })
    const result = play(f).state
    expect(result.reserve!.lots.map(l => l.remainingAmount)).toEqual([0, 4])
    expect(result.seats[0].stack - f.h.seats[0].stack).toBe(116)
  })
})
