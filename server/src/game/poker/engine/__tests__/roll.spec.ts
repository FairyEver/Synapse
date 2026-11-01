import { describe, expect, it } from "vitest"
import { orderedDeck } from "../deck"
import { resolveRules } from "../rules"
import { act, assertHandIntegrity, chooseRollCard, legalActions, quoteRoll, removeFromHand, startHand, startRoll, type HandState } from "../hand-runner"
const rules = { ruleOptions: { roll: true }, rollPricingVersion: "roll-v1" }
const entropy = (max: number) => max - 1
const hand = (n = 3, variant: "standard52" | "short32" = "standard52") => startHand(Array.from({ length: n }, (_, seatNo) => ({ seatNo, stack: 1000 })), 0, orderedDeck(variant), { ...rules, variant })
const roll = (h: HandState, kind: "normal" | "super" = "normal", index = 0) => startRoll(h, h.actionOnSeat!, { rollId: `r${h.roll!.history.length}`, kind, cardIndex: index, fee: quoteRoll(h, h.actionOnSeat!)[kind].fee }, entropy)
function nextStreet(h: HandState) {
  const street = h.street
  while (h.street === street) h = act(h, h.actionOnSeat!, { action: legalActions(h, h.actionOnSeat!).toCall ? "call" : "check" })
  return h
}
describe("Roll pricing and compatibility", () => {
  it("keeps historical rules disabled and refuses missing or unknown enabled versions", () => {
    expect(resolveRules()).toEqual({ variant: "standard52", smallBlind: 1, bigBlind: 2 })
    expect(quoteRoll(startHand([{ seatNo: 0, stack: 10 }, { seatNo: 1, stack: 10 }], 0, orderedDeck()), 0).enabled).toBe(false)
    expect(() => resolveRules({ ruleOptions: { roll: true } })).toThrow()
    expect(() => resolveRules({ ...rules, rollPricingVersion: "future" })).toThrow()
    expect(() => resolveRules({ ...rules, rollPricingVersion: null })).toThrow("POKER_ROLL_VERSION_UNSUPPORTED")
    expect(resolveRules({ ruleOptions: {}, rollPricingVersion: null })).not.toHaveProperty("rollPricingVersion")
  })
  it.each([['preflop', 3, 8], ['flop', 6, 14], ['turn', 16, 31]] as const)("prices %s using public capped money", (street, normal, superFee) => {
    const h = hand(2)
    h.street = street
    // P=200,E=3000 => T=5000; use five participants with own cap=1000.
    h.seats = Array.from({ length: 5 }, (_, seatNo) => ({ ...h.seats[0], seatNo, total: 40, stack: seatNo === 0 ? 960 : 750 }))
    h.actionOnSeat = 0
    if (street === 'flop') h.seats = Array.from({ length: 6 }, (_, seatNo) => ({ ...h.seats[0], seatNo, total: 10, stack: 990 }))
    if (street === 'turn') h.seats[0].total = 300 // P=460,E=3000 => T=7600
    const q = quoteRoll(h, 0)
    expect([q.normal.fee, q.super.fee]).toEqual([normal, superFee])
    const hidden = structuredClone(h); hidden.deck.reverse(); hidden.seats[1].hole.reverse()
    expect(quoteRoll(hidden, 0)).toEqual(q)
  })
})
describe("Roll transitions", () => {
  it("normal replacement is forced, immutable, returns old card and freezes compensation in dealer order", () => {
    const h = hand(), original = structuredClone(h), seat = h.actionOnSeat!, old = h.seats[seat].hole[0], candidate = h.deck[h.deck.length - 1]
    const next = roll(h)
    expect(h).toEqual(original)
    expect(next.seats[seat].hole[0]).toBe(candidate)
    expect(next.deck).toContain(old)
    expect(next.roll!.originalHoles[seat]).toEqual(original.seats[seat].hole)
    expect(next.roll!.pending).toBeNull()
    expect(next.roll!.history[0]).toMatchObject({ oldCard: old, candidates: [candidate], selectedIndex: 0, count: 1 })
    expect(next.actionOnSeat).toBe(h.actionOnSeat)
    expect(next.seats.map(s => [s.total, s.streetBet, s.startingStack])).toEqual(h.seats.map(s => [s.total, s.streetBet, s.startingStack]))
    expect(Object.values(next.roll!.credits).reduce((a, b) => a + b, 0)).toBe(next.roll!.paid[seat])
    assertHandIntegrity(next)
  })
  it("super saves three candidates, blocks progress, only accepts committed identity and returns unused cards", () => {
    const h = roll(hand(), "super"), original = structuredClone(h), pending = h.roll!.pending!
    expect(pending.candidates).toHaveLength(3)
    expect(() => act(h, h.actionOnSeat!, { action: "call" })).toThrow()
    expect(() => removeFromHand(h, 1)).toThrow()
    expect(() => roll(h)).toThrow()
    expect(() => chooseRollCard(h, 1, pending.id, 1, entropy)).toThrow()
    expect(() => chooseRollCard(h, pending.seatNo, "wrong", 1, entropy)).toThrow()
    expect(() => chooseRollCard(h, pending.seatNo, pending.id, 3, entropy)).toThrow()
    assertHandIntegrity(h)
    const chosen = chooseRollCard(h, pending.seatNo, pending.id, 1, entropy)
    expect(h).toEqual(original)
    expect(chosen.seats.find(s => s.seatNo === pending.seatNo)!.hole[pending.cardIndex]).toBe(pending.candidates[1])
    expect(chosen.deck).toEqual(expect.arrayContaining([pending.oldCard, pending.candidates[0], pending.candidates[2]]))
    expect(chosen.roll!.counts).toEqual(h.roll!.counts)
    expect(chosen.roll!.pending).toBeNull()
    assertHandIntegrity(chosen)
  })
  it("counts persist across streets, river disables, settlement releases compensation exactly once", () => {
    let h = roll(hand(2)); h = nextStreet(h)
    const seat = h.actionOnSeat!; h = roll(h); h = nextStreet(h); h = roll(h)
    expect(h.roll!.counts[seat]).toBe(2)
    h = nextStreet(h)
    expect(quoteRoll(h, h.actionOnSeat!).normal.available).toBe(false)
    h = nextStreet(h)
    expect(h.roll!.released).toBe(true)
    expect(h.seats.reduce((s, p) => s + p.stack, 0)).toBe(2000)
    assertHandIntegrity(h)
  })
  it("preserves all-in compensation and side pots; folding recipients retain their credits", () => {
    let h = hand()
    h = act(h, 0, { action: "raise", to: 999 })
    h = act(h, 1, { action: "allin" })
    h = roll(h)
    expect(h.roll!.history[0].compensations[1]).toBeGreaterThan(0)
    h = act(h, 2, { action: "fold" })
    h = act(h, 0, { action: "call" })
    expect(h.street).toBe("settled")
    expect(h.pots.length).toBeGreaterThan(1)
    assertHandIntegrity(h)
  })
  it("supports ten-player short deck repeatedly without losing burn/candidate cards", () => {
    let h = hand(10, "short32")
    for (let i = 0; i < 8; i++) {
      h = roll(h, "super", i % 2)
      h = chooseRollCard(h, h.actionOnSeat!, h.roll!.pending!.id, i % 3, entropy)
      assertHandIntegrity(h)
    }
    while (h.street !== "settled") { h = nextStreet(h); assertHandIntegrity(h) }
    expect(h.burnedCards).toHaveLength(3)
    expect(h.deck).toHaveLength(4)
  })
  it("rejects stale price, unaffordable fee and duplicate IDs, and detects lost or duplicate cards", () => {
    const h = hand()
    expect(() => startRoll(h, 0, { rollId: "x", kind: "normal", cardIndex: 0, fee: 999 }, entropy)).toThrow()
    const next = roll(h)
    expect(() => startRoll(next, 0, { rollId: "r0", kind: "normal", cardIndex: 0, fee: quoteRoll(next, 0).normal.fee }, entropy)).toThrow()
    const broken = structuredClone(next); broken.deck.pop()
    expect(() => assertHandIntegrity(broken)).toThrow()
    const poor = structuredClone(h); poor.seats[0].stack = 1
    expect(quoteRoll(poor, 0).normal.available).toBe(false)
  })
})

describe("Roll invariant boundaries", () => {
  it("rejects corrupted card state before any ordinary action or removal and preserves legacy snapshots", () => {
    const h = hand(); h.deck.pop()
    expect(() => act(h, 0, { action: "call" })).toThrow("POKER_HAND_CARDS_INVALID")
    expect(() => removeFromHand(h, 1)).toThrow("POKER_HAND_CARDS_INVALID")
    let old = startHand([{ seatNo: 0, stack: 10 }, { seatNo: 1, stack: 10 }], 0, orderedDeck())
    delete old.burnedCards
    old = nextStreet(old)
    expect(old.burnedCards).toBeUndefined()
    while (old.street !== "settled") old = nextStreet(old)
    assertHandIntegrity(old)
  })
  it("uses injected entropy to draw without replacement, rejects bad entropy immutably", () => {
    const h = hand(), original = structuredClone(h), q = quoteRoll(h, 0)
    const input = { rollId: "entropy", kind: "super" as const, cardIndex: 0, fee: q.super.fee }
    expect(startRoll(h, 0, input, () => 0).roll!.pending!.candidates).toEqual(h.deck.slice(0, 3))
    expect(startRoll(h, 0, input, entropy).roll!.pending!.candidates).toEqual(h.deck.slice(-3).reverse())
    expect(() => startRoll(h, 0, input, max => max)).toThrow()
    expect(h).toEqual(original)
  })
  it("applies the one-chip minimum gap before multiplying shared counts and rejects equal balance", () => {
    const h = startHand([{ seatNo: 0, stack: 20 }, { seatNo: 1, stack: 20 }], 0, orderedDeck(), rules)
    h.roll!.counts[0] = 3
    const q = quoteRoll(h, 0)
    expect([q.normal.fee, q.super.fee]).toEqual([4, 8])
    h.seats[0].stack = 4
    expect(quoteRoll(h, 0).normal.available).toBe(false)
  })
  it("retains frozen credits for later-folded recipients and pays dealer-left remainder exactly", () => {
    let h = startHand(Array.from({ length: 4 }, (_, seatNo) => ({ seatNo, stack: 20 })), 0, orderedDeck(), rules)
    h = roll(h, "super") // seat 3 pays 2; left of dealer receives remainder first.
    expect(h.roll!.history[0].compensations).toEqual({ 0: 0, 1: 1, 2: 1 })
    h = chooseRollCard(h, 3, h.roll!.pending!.id, 0, entropy)
    h = act(h, 3, { action: "call" }); h = act(h, 0, { action: "fold" }); h = act(h, 1, { action: "fold" })
    expect(h.roll!.credits[1]).toBe(1)
    while (h.street !== "settled") h = nextStreet(h)
    expect(h.roll!.credits[1]).toBe(1)
    expect(h.seats[1].stack).toBe(20)
    expect(h.roll!.released).toBe(true)
    assertHandIntegrity(h)
  })
})
