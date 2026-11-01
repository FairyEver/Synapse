import { describe, expect, it } from "vitest"
import { orderedDeck } from "../engine/deck"
import { startHand, startRoll, chooseRollCard, quoteRoll } from "../engine/hand-runner"
import { botRollObservation, chooseBotRoll, chooseBotRollCandidate, type BotRollObservation } from "../bot-roll-policy"
const setup = () => startHand([{ seatNo: 0, stack: 1000 }, { seatNo: 1, stack: 1000 }], 0, orderedDeck(), { ruleOptions: { roll: true }, rollPricingVersion: "roll-v1" })
const entropy = (max: number) => max - 1
function observation(): BotRollObservation { return botRollObservation(setup(), 0) }
describe("visible-information Roll policy", () => {
  it("projects a copied whitelist invariant under unseen deck/opponent hole permutations", () => {
    const h = setup(), a = botRollObservation(h, 0), b = structuredClone(h)
    ;[b.deck[0], b.seats[1].hole[0]] = [b.seats[1].hole[0], b.deck[0]]
    b.deck.reverse()
    expect(botRollObservation(b, 0)).toEqual(a)
    expect(chooseBotRoll(botRollObservation(b, 0))).toEqual(chooseBotRoll(a))
    expect(a).not.toHaveProperty("deck")
    expect(a).not.toHaveProperty("seats")
    a.hole[0] = "As"
    expect(h.seats[0].hole[0]).not.toBe("As")
  })
  it("includes only own private returns; public history excludes old positions/cards/candidates", () => {
    let h = setup()
    h = startRoll(h, 0, { rollId: "private", kind: "super", cardIndex: 1, fee: quoteRoll(h, 0).super.fee }, entropy)
    expect(botRollObservation(h, 0).pending).toMatchObject({ rollId: "private", cardIndex: 1, candidates: h.roll!.pending!.candidates })
    expect(botRollObservation(h, 1).pending).toBeNull()
    expect(chooseBotRoll(botRollObservation(h, 0))).toBeNull()
    h = chooseRollCard(h, 0, "private", 1, entropy)
    const own = botRollObservation(h, 0), other = botRollObservation(h, 1)
    expect(own.privateHistory[0]).toMatchObject({ oldCard: h.roll!.history[0].oldCard, selectedIndex: 1 })
    expect(other.privateHistory).toEqual([])
    expect(other.history).toEqual([{ seatNo: 0, kind: "super", fee: h.roll!.history[0].fee, count: 1 }])
  })
  it("chooses a positive-gain Roll at low prices and abstains at unaffordable/no-gain conditions", () => {
    const o = observation()
    o.hole = ["2s", "3h"]
    o.effectivePot = 500; o.effectiveFuture = 1000
    o.quote.normal = { fee: 1, available: true }; o.quote.super = { fee: 2, available: true }
    const action = chooseBotRoll(o)
    expect(action).not.toBeNull()
    expect(action!.cardIndex).toBe(0)
    const expensive = structuredClone(o)
    expensive.quote.normal.fee = 10000; expensive.quote.super.fee = 20000
    expect(chooseBotRoll(expensive)).toBeNull()
    o.hole = ["As", "Ah"]
    expect(chooseBotRoll(o)).toBeNull()
    o.quote.normal.available = false; o.quote.super.available = false
    expect(chooseBotRoll(o)).toBeNull()
  })
  it("uses existing postflop evaluation, keeps first equal candidate, and supports short32", () => {
    const o = observation(); o.hole = ["As", "2h"]; o.board = ["Ac", "Kd", "9s"]
    expect(chooseBotRollCandidate(o, 1, ["3s", "Ah", "7s"])).toBe(1)
    expect(chooseBotRollCandidate(o, 1, ["Ah", "Ad", "7s"])).toBe(0)
    o.variant = "short32"; o.hole = ["7s", "8h"]; o.board = []
    expect(chooseBotRollCandidate(o, 0, ["9c", "As", "8c"])).toBe(2)
  })
  it("stops a marginal Roll when an opponent may have taken the known returned cards", () => {
    const o = observation()
    o.hole = ["Kh", "3h"]
    o.originalPlayerCount = 10; o.remainingDeckCount = 32
    o.effectivePot = 5000; o.effectiveFuture = 1000
    o.privateHistory = [{ ordinal: 0, boardCount: 0, oldCard: "As", candidates: ["Kh", "Kd", "Kc"], selectedIndex: 0 }]
    o.history = [{ seatNo: 0, kind: "super", count: 1, fee: 2 }]
    o.quote.normal = { fee: 336, available: true }
    o.quote.super.available = false
    expect(chooseBotRoll(o)).toEqual({ kind: "normal", cardIndex: 1, fee: 336 })
    o.history.push({ seatNo: 1, kind: "normal", count: 1, fee: 1 })
    expect(chooseBotRoll(o)).toBeNull()
  })
  it("does not treat preflop returns as certain after the flop is dealt", () => {
    const o = observation()
    o.hole = ["Kh", "3h"]; o.board = ["Ac", "Ad", "Tc"]; o.street = "flop"
    o.originalPlayerCount = 10; o.remainingDeckCount = 28; o.burnedCount = 1
    o.effectivePot = 5000; o.effectiveFuture = 1000
    o.history = [{ seatNo: 0, kind: "super", count: 1, fee: 2 }]
    o.privateHistory = [{ ordinal: 0, boardCount: 0, oldCard: "As", candidates: ["Kh", "Kd", "Kc"], selectedIndex: 0 }]
    o.quote.normal = { fee: 175, available: true }
    o.quote.super.available = false
    expect(chooseBotRoll(o)).toBeNull()
    // The same visible returns made on this street remain usable knowledge.
    const returnedAfterFlop = structuredClone(o)
    returnedAfterFlop.privateHistory[0].boardCount = 3
    expect(chooseBotRoll(returnedAfterFlop)).toEqual({ kind: "normal", cardIndex: 1, fee: 175 })
  })
})
