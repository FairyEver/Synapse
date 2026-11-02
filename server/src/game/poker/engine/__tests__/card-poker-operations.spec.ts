import { describe, expect, it } from "vitest"
import { registerPokerCardOperations, invalidatePokerObservations, publicHoleCards } from "../cards/poker-operations"
import { OperationRegistry } from "../cards/registry"
import { runResolution } from "../cards/runner"
import { assertHandIntegrity, quoteRoll, startRoll, chooseRollCard, type HandState } from "../hand-runner"
import { cardContext, makeCardHand } from "../../__tests__/card-test-fixtures"
import type { DomainOperation, ResolutionContext } from "../cards/types"

function run(h: HandState, type: string, input: Record<string, unknown>, context: ResolutionContext = cardContext()) {
  const registry = new OperationRegistry<HandState>({ effects: s => s.cards!.effects })
  registerPokerCardOperations(registry)
  return runResolution(h, [{ type, input, cardId: "test" } satisfies DomainOperation], context, registry)
}
describe.each(["standard52", "short32"] as const)("扑克牌领域 %s", variant => {
  it("replace_draw_before_return：旧牌不参加本次随机抽取", () => {
    const h = makeCardHand({ variant }), old = h.seats[0].hole[0], top = h.deck[0]
    const next = run(h, "poker.replace", { seatNo: 0, cardIndex: 0, mode: "draw" }).state
    expect(next.seats[0].hole[0]).toBe(top); expect(next.deck).toContain(old)
    expect(h.seats[0].hole[0]).toBe(old); assertHandIntegrity(next)
  })
  it("reset_return_before_draw：原牌先回堆，可以抽回原牌", () => {
    const h = makeCardHand({ variant }), old = [...h.seats[0].hole]
    const next = run(h, "poker.reset", { seatNo: 0 }, cardContext({ randomInt: max => max - 1 })).state
    expect(next.seats[0].hole).toEqual([...old].reverse()); assertHandIntegrity(next)
  })
  it("all_holes_shuffle_protected_excluded：受保护者整副保留，全下机器人可被影响", () => {
    const h = makeCardHand({ variant, humans: 2, bots: 1 }), protectedHole = [...h.seats[1].hole]
    h.seats[2].allIn = true
    const next = run(h, "poker.shuffleHoles", { excludedSeatNos: [1] }).state
    expect(next.seats[1].hole).toEqual(protectedHole)
    expect(next.seats[0].hole).not.toEqual(h.seats[0].hole)
    expect(next.seats[2].hole).not.toEqual(h.seats[2].hole)
    assertHandIntegrity(next)
  })
  it("peek_skips_burn：私有观察不会改变牌序，洗牌之后原记录失效", () => {
    const h = makeCardHand({ variant }), next = run(h, "poker.peek", { seatNo: 0, mode: "next" }).state
    expect(next.cards!.privateResults[0]).toMatchObject({ ownerAdmissionId: "admission-0", values: [h.deck[1]], valid: true })
    expect(next.deck).toEqual(h.deck)
    const stage = run(h, "poker.peek", { seatNo: 0, mode: "stage" }).state
    expect(stage.cards!.privateResults[0].values).toEqual(h.deck.slice(1, 4))
    invalidatePokerObservations(next)
    expect(next.cards!.privateResults[0].valid).toBe(false)
    expect(next.cards!.privateResults[0].values).toEqual([h.deck[1]])
    expect(() => run({ ...h, street: "river" }, "poker.peek", { seatNo: 0, mode: "next" })).toThrow()
  })
  it("public_marker_moves_with_card：实体换人仍公开，回堆不暴露牌堆位置", () => {
    const h = makeCardHand({ variant }), card = h.seats[0].hole[0]
    const revealed = run(h, "poker.reveal", { seatNo: 0, cardIndex: 0, duration: "hand" }).state
    const swapped = run(revealed, "poker.exchange", { seatNo: 0, targetSeatNo: 1, cardIndex: 0 }).state
    expect(publicHoleCards(swapped, 1)).toContain(card)
    expect(publicHoleCards(swapped, 0)).toEqual([])
    const slot = swapped.seats[1].hole.indexOf(card)
    const returned = run(swapped, "poker.replace", { seatNo: 1, cardIndex: slot, mode: "draw" }).state
    expect(publicHoleCards(returned, 1)).toEqual([])
    expect(returned.cards!.publicMarkers?.[0].card).toBe(card)
    assertHandIntegrity(returned)
  })
  it("候选在保留区且全局互斥，选中后其余原实体回堆", () => {
    const h = makeCardHand({ variant, roll: true })
    const next = run(h, "poker.replace", { seatNo: 0, cardIndex: 0, mode: "candidates", paymentVersion: "p" }).state
    expect(next.cards!.pending).toMatchObject({ kind: "poker", origin: "card", candidates: h.deck.slice(0, 3), paymentVersion: "p" })
    assertHandIntegrity(next)
    expect(quoteRoll(next, 0).normal.available).toBe(false)
    expect(() => run(next, "poker.replace", { seatNo: 0, cardIndex: 1, mode: "draw" })).toThrow("POKER_CARD_CHOICE_REQUIRED")
    const chosen = run(next, "poker.choose", { admissionId: "admission-0", choiceId: next.cards!.pending!.id, index: 1 }).state
    expect(chosen.seats[0].hole[0]).toBe(h.deck[1]); expect(chosen.cards!.pending).toBeNull()
    expect(chosen.deck).toContain(h.deck[0]); expect(chosen.deck).toContain(h.deck[2]); assertHandIntegrity(chosen)
  })
  it("颜色缺失仍成功但不换，弃牌目标不合法；原Roll同槽重抽保留行为", () => {
    const h = makeCardHand({ variant, roll: true })
    const old = h.seats[0].hole[0], before = structuredClone(h)
    // Put every red card outside the draw pile while retaining a complete physical deck.
    h.burnedCards!.push(...h.deck.filter(c => "hd".includes(c[1])))
    h.deck = h.deck.filter(c => !"hd".includes(c[1]))
    expect(run(h, "poker.replace", { seatNo: 0, cardIndex: 0, mode: "red" }).state.seats[0].hole[0]).toBe(old)
    before.seats[1].folded = true
    expect(() => run(before, "poker.exchange", { seatNo: 0, targetSeatNo: 1, cardIndex: 0 })).toThrow()
    const active = makeCardHand({ variant, roll: true }), quote = quoteRoll(active, 0)
    let rolled = startRoll(active, 0, { rollId: "r1", kind: "super", cardIndex: 0, fee: quote.super.fee }, () => 0)
    rolled = startRoll(rolled, 0, { rollId: "r2", kind: "super", cardIndex: 0, fee: quoteRoll(rolled, 0).super.fee }, () => 0)
    rolled = chooseRollCard(rolled, 0, "r2", 0, () => 0)
    assertHandIntegrity(rolled)
  })
  it("候选不足取实际一张，选第一项后仍满足完整实体牌组", () => {
    const h = makeCardHand({ variant }), card = h.deck[0]
    h.burnedCards!.push(...h.deck.splice(1))
    const next = run(h, "poker.replace", { seatNo: 0, cardIndex: 0, mode: "candidates" }).state
    expect(next.cards!.pending!.candidates).toEqual([card])
    const chosen = run(next, "poker.choose", { admissionId: "admission-0", choiceId: next.cards!.pending!.id, index: 0 }).state
    expect(chosen.seats[0].hole[0]).toBe(card); assertHandIntegrity(chosen)
  })
})
