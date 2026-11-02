import { describe, expect, it } from "vitest"
import { createCardRegistry, CARD_CATALOG_V1, CARD_CATALOG_V1_SNAPSHOT } from "../cards/catalog-v1"
import { cardChoices, createCardOperationRegistry, planCardPlay, quoteCardPlay } from "../cards/commands"
import { runResolution } from "../cards/runner"
import { assertHandIntegrity, quoteRoll } from "../hand-runner"
import { makeCardHand, cardContext } from "../../__tests__/card-test-fixtures"
import { applyFundedBet, quoteFundedBet } from "../chips/funded-betting"
import { resolveHandCommand } from "../resolve-hand"
import type { PokerCardPlayInput } from "@synapse/shared/game-contracts"

function fixture(variant: "standard52" | "short32" = "standard52", seed = 20261103, humans = 2) {
  const registry = createCardRegistry()
  let h = makeCardHand({ variant, humans, roll: true, definitions: CARD_CATALOG_V1 }), seq = 0, entropy = seed >>> 0
  h.chipRulesVersion = "chips-v2"; h.participants = h.cards!.participants; h.cards!.catalogSnapshot = structuredClone(CARD_CATALOG_V1_SNAPSHOT)
  h.turnClock = { seatNo: 0, turnId: "test-turn", startedAt: 0, deadlineAt: 600000, reductions: {} }
  const randomInt = (max: number) => { entropy = (Math.imul(entropy, 1664525) + 1013904223) >>> 0; return entropy % max }
  function check() {
    assertHandIntegrity(h)
    expect(h.seats.reduce((n, s) => n + s.stack + s.total, 0) + (h.reserve?.lots.reduce((n, l) => n + l.remainingAmount, 0) ?? 0)).toBe(humans * 1000)
    const c = h.cards!, zones = [...c.pool, ...c.reserved, ...c.spent, ...Object.values(c.hands).flat()]
    expect(zones.length).toBe(90 + c.generatedCount)
    expect(new Set(zones.map(c => c.id)).size).toBe(zones.length)
  }
  function give(id: string, actor = 0) {
    const admission = `admission-${actor}`, own = h.cards!.hands[admission] ??= []
    for (const zone of [h.cards!.pool, ...Object.values(h.cards!.hands)]) {
      const index = zone.findIndex(c => c.definitionId === id)
      if (index >= 0) { const card = zone.splice(index, 1)[0]; own.push(card); check(); return card.id }
    }
    throw new Error(`Missing fixture card ${id}`)
  }
  function play(instanceId: string, actor = 0, selections?: Record<string, string | number>) {
    h.actionOnSeat = actor; h.turnClock!.seatNo = actor
    const admission = `admission-${actor}`, definition = registry.get(h.cards!.hands[admission].find(c => c.id === instanceId)!.definitionId)
    const selected = selections ?? Object.fromEntries(cardChoices(h, definition, admission, instanceId, registry).map(c => [c.key, c.options[0]?.value]))
    const input: PokerCardPlayInput = { roomCode: "TEST", handId: "test-hand", street: h.street as "preflop", expectedActionSeq: seq, controlVersion: 0, actionId: `play-${seq}`, instanceId, selections: selected, expectedPaymentVersion: "" }
    input.expectedPaymentVersion = quoteCardPlay(h, input, registry).version
    const context = cardContext({ actorSeatNo: actor, actorAdmissionId: admission, rootActionId: `play-${++seq}`, actionSeq: seq, nowMs: 1000, randomInt })
    const result = runResolution(h, planCardPlay(h, input, context, registry), context, createCardOperationRegistry(registry))
    h = result.state; check(); return result.frame
  }
  return { get h() { return h }, give, play, check, roll() {
    const quote = quoteRoll(h, 0), context = cardContext({ rootActionId: `roll-${++seq}`, actionSeq: seq, nowMs: 1000, randomInt })
    h = resolveHandCommand(h, { kind: "roll.start", input: { roomCode: "TEST", handId: "test-hand", street: "preflop", expectedActionSeq: seq - 1, controlVersion: 0, actionId: context.rootActionId, cardIndex: 0, kind: "normal", expectedFee: quote.normal.fee, expectedPaymentVersion: quote.normal.payment!.version } }, context, registry).state
    check()
  } }
}

describe.each(["standard52", "short32"] as const)("固定种子卡牌组合 %s", variant => {
  it("补给后换牌和赦免后Roll分别守恒，钻石照常支付", () => {
    const f = fixture(variant), supply = f.give("22"), replace = f.give("01"), waiver = f.give("31"), old = [...f.h.seats[0].hole]
    f.play(supply); expect(f.h.cards!.hands["admission-0"]).toHaveLength(4)
    f.play(replace, 0, { hole: 0 }); expect(f.h.seats[0].hole).not.toEqual(old)
    f.play(waiver); const stack = f.h.seats[0].stack, coins = quoteRoll(f.h, 0).coins!.balance
    f.roll(); expect(f.h.seats[0].stack).toBe(stack); expect(quoteRoll(f.h, 0).coins!.balance).toBe(coins - 1)
    expect(f.h.cards!.effects.some(e => e.kind === "waiver")).toBe(false)
  })
  it("暂存→盗取→原付款人退款精确保留原份额", () => {
    const f = fixture(variant, 17, 3), deposit = f.give("38"), steal = f.give("33", 1), refund = f.give("35")
    f.play(deposit); expect(f.h.reserve!.lots[0].remainingAmount).toBe(4)
    f.play(steal, 1); expect(f.h.reserve!.lots[0].remainingAmount).toBe(2)
    f.play(refund); expect(f.h.reserve!.lots[0]).toMatchObject({ originalAmount: 4, remainingAmount: 0, payerAdmissionId: "admission-0" })
    expect(f.h.reserve!.movements.map(m => [m.kind, m.amount])).toEqual([["deposit", 4], ["steal", 2], ["refund", 2]])
  })
  it("窥牌被护罩拦截，之后反窥仅本人可见且不成环", () => {
    const f = fixture(variant), shield = f.give("43", 1), reflect = f.give("47", 1), peek = f.give("13"), peek2 = f.give("13")
    f.play(shield, 1); f.play(peek, 0, { player: 1 }); expect(f.h.cards!.privateResults).toEqual([])
    f.play(reflect, 1); const frame = f.play(peek2, 0, { player: 1 })
    expect(f.h.cards!.privateResults).toMatchObject([{ ownerAdmissionId: "admission-1" }])
    expect(frame.events.filter(e => e.type === "poker.observed").every(e => e.audience === "owner")).toBe(true)
  })
  it("已全下玩家底牌仍可受影响，不能因此恢复行动资格", () => {
    const f = fixture(variant), swap = f.give("03"), before = [...f.h.seats[1].hole]
    f.h.actionOnSeat = 1
    Object.assign(f.h, applyFundedBet(f.h, 1, { action: "allin" }, quoteFundedBet(f.h, 1, { action: "allin" })))
    f.check(); f.play(swap, 0, { hole: 0 }); expect(f.h.seats[1].hole).not.toEqual(before)
    expect(f.h.seats[1]).toMatchObject({ allIn: true, stack: 0 })
  })
  for (const seed of [3, 17, 73, 20261103]) it(`生成与状态两两组合守恒 seed=${seed}`, () => {
    for (const generate of ["28", "29", "30"]) for (const status of ["40", "41", "43", "47", "50", "51", "54", "55", "56", "57"]) {
      const f = fixture(variant, seed), first = f.give(status), second = f.give(generate)
      f.give("21"); f.play(first); f.play(second)
      expect(f.h.cards!.generatedCount).toBe(generate === "30" ? 2 : 1)
      expect(f.h.turnClock!.deadlineAt).toBeLessThanOrEqual(1200000)
    }
  })
})
