import { describe, expect, it } from "vitest"
import { resolveHandCommand, type HandCommand } from "../engine/resolve-hand"
import { startHand, assertHandIntegrity, quoteRoll, type HandState } from "../engine/hand-runner"
import { createCardRegistry } from "../engine/cards/catalog-v1"
import { quoteCardPlay } from "../engine/cards/commands"
import { orderedDeck } from "../engine/deck"
import { cardContext } from "./card-test-fixtures"
import type { PokerCardPlayInput } from "@synapse/shared/game-contracts"
import { betPaymentVersion } from "../engine/chips/funded-betting"

const catalog = () => createCardRegistry()
function resolve(h: HandState, command: HandCommand, seq: number, nowMs = 0) {
  const actor = h.participants!.find(p => p.seatNo === h.actionOnSeat)
  return resolveHandCommand(h, command, cardContext({ actionSeq: seq, actorSeatNo: actor?.seatNo ?? null, actorAdmissionId: actor?.admissionId ?? null, rootActionId: `root-${seq}`, nowMs, source: command.kind === "hand.start" ? "system" : command.kind === "timeout" ? "timeout" : actor?.kind === "bot" ? "rules_bot" : "human" }), catalog())
}
function initial(humans = 2, bots = 0, stack = 1000, bigBlind = 2) {
  const h = startHand(Array.from({ length: humans + bots }, (_, seatNo) => ({ seatNo, stack })), 0, orderedDeck(), { variant: "standard52", smallBlind: bigBlind / 2, bigBlind, ruleOptions: { cards: true, roll: true }, rollPricingVersion: "roll-v1", cardRulesVersion: "cards-v1", chipRulesVersion: "chips-v2" }, { deferProgress: true })
  h.participants = h.seats.map(p => ({ admissionId: `admission-${p.seatNo}`, userId: `user-${p.seatNo}`, seatNo: p.seatNo, kind: p.seatNo < humans ? "human" : "bot" }))
  return resolve(h, { kind: "hand.start" }, 0)
}
function give(h: HandState, id: string) {
  const owner = h.participants!.find(p => p.seatNo === h.actionOnSeat)!, hand = h.cards!.hands[owner.admissionId]
  let instance = hand.find(c => c.definitionId === id)
  if (!instance) {
    const index = h.cards!.pool.findIndex(c => c.definitionId === id)
    if (index < 0) throw new Error("fixture card unavailable")
    instance = h.cards!.pool.splice(index, 1)[0]; hand.push(instance)
  }
  return instance.id
}
function cardInput(h: HandState, id: string, seq: number, selections: Record<string, string | number> = {}): PokerCardPlayInput {
  const input: PokerCardPlayInput = { roomCode: "1234", handId: "test-hand", street: h.street as "preflop", expectedActionSeq: seq - 1, controlVersion: 1, actionId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, instanceId: give(h, id), selections, expectedPaymentVersion: "" }
  input.expectedPaymentVersion = quoteCardPlay(h, input, catalog()).version
  return input
}
describe("卡牌统一牌局生命周期", () => {
  it("start_blinds_then_cards_then_turn：盲注后发真人三张，机器人零张", () => {
    const result = initial(2, 1), h = result.state
    expect(h.seats.map(s => s.total)).toEqual([0, 1, 2])
    expect(h.cards!.hands["admission-0"]).toHaveLength(3); expect(h.cards!.hands["admission-1"]).toHaveLength(3)
    expect(h.cards!.hands["admission-2"] ?? []).toHaveLength(0)
    const types = result.frame.events.map(e => e.type)
    expect(types.indexOf("bet.blinds")).toBeLessThan(types.indexOf("ability.dealt")); expect(types.indexOf("ability.dealt")).toBeLessThan(types.indexOf("turn.started"))
    expect(h.turnClock).toMatchObject({ startedAt: 0, deadlineAt: 600000, seatNo: 0 }); assertHandIntegrity(h)
  })
  it("stage_once_after_board：公共牌→补牌→新回合；幸运帷幕按整个批次触发一次", () => {
    let h = initial(3).state
    h.cards!.effects.push({ id: "curtain", kind: "refill_field", cardId: "55", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "neutral", installedSeq: 0, remaining: 1, dispellable: true, data: {} })
    let last = initial(3)
    for (let seq = 1; seq <= 3; seq++) {
      const actor = h.actionOnSeat!, decision = actor === 2 ? { action: "check" as const } : { action: "call" as const }
      last = resolve(h, { kind: "bet", seatNo: actor, decision, controlVersion: 1, expectedPaymentVersion: betPaymentVersion(h, actor, "test-hand", seq - 1, 1) }, seq); h = last.state
    }
    expect(h.street).toBe("flop"); expect(h.board).toHaveLength(3)
    expect(Object.values(h.cards!.hands).map(c => c.length)).toEqual([5, 5, 5]); expect(h.cards!.effects).toEqual([])
    const types = last.frame.events.map(e => e.type)
    expect(types.indexOf("street.started")).toBeLessThan(types.indexOf("ability.dealt")); expect(types.indexOf("ability.dealt")).toBeLessThan(types.indexOf("turn.started"))
    const before = structuredClone(h); quoteRoll(h, h.actionOnSeat!); expect(h).toEqual(before)
  })
  it("waiver_roll_atomic：20筹码全免，钻石照付，次数照计，零额不建暂存", () => {
    let h = initial(2, 0, 39000, 10).state
    h.cards!.effects.push({ id: "waive", kind: "waiver", cardId: "31", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "positive", remaining: 1, installedSeq: 0, dispellable: true, data: { cap: 100 } })
    const quote = quoteRoll(h, 0), before = h.seats[0].stack, clock = structuredClone(h.turnClock)
    expect(quote.normal.fee).toBe(20)
    h = resolve(h, { kind: "roll.start", input: { roomCode: "1234", handId: "test-hand", street: "preflop", kind: "normal", cardIndex: 0, expectedFee: 20, expectedPaymentVersion: quote.normal.payment!.version, expectedActionSeq: 0, controlVersion: 1, actionId: "00000000-0000-4000-8000-000000000001" } }, 1).state
    expect(h.seats[0].stack).toBe(before); expect(quoteRoll(h, 0).coins!.balance).toBe(quote.coins!.balance - 1)
    expect(h.roll!.counts[0]).toBe(1); expect(h.roll!.paid[0]).toBe(0); expect(h.roll!.history[0]).toMatchObject({ fee: 0, nominalFee: 20, waivedFee: 20 })
    expect(h.reserve!.lots).toEqual([]); expect(h.cards!.effects).toEqual([]); expect(h.turnClock).toEqual(clock); assertHandIntegrity(h)
  })
  it("pending_blocks_all_cards：06待选禁止03/58/51；超时第一项后完成原撤出与清理", () => {
    let h = initial().state
    const input = cardInput(h, "06", 1, { hole: 0 })
    h = resolve(h, { kind: "card.play", input }, 1).state
    const first = h.cards!.pending!.candidates[0]
    for (const id of ["03", "58", "51"]) {
      const attempted = cardInput(h, id, 2, id === "03" ? { hole: 0 } : {})
      expect(() => resolve(h, { kind: "card.play", input: attempted }, 2)).toThrow("POKER_CARD_CHOICE_REQUIRED")
    }
    const timed = resolve(h, { kind: "timeout", seatNo: 0 }, 2, 600000)
    expect(timed.frame.seq).toBe(2); expect(timed.state.seats[0].hole[0]).toBe(first)
    expect(timed.state.street).toBe("settled"); expect(timed.state.cards!.pending).toBeNull()
    expect(Object.values(timed.state.cards!.hands).flat()).toEqual([]); expect(timed.state.cards!.effects).toEqual([]); assertHandIntegrity(timed.state)
  })
  it("名义全下与暂存最终派发只含真实资金，资金到账不复活全下", () => {
    let h = initial().state
    h.cards!.effects.push({ id: "waive", kind: "waiver", cardId: "31", ownerAdmissionId: "admission-0", ownerSeatNo: 0, polarity: "positive", remaining: 1, installedSeq: 0, dispellable: true, data: { cap: 100 } })
    h = resolve(h, { kind: "bet", seatNo: 0, decision: { action: "allin" }, controlVersion: 1, expectedPaymentVersion: betPaymentVersion(h, 0, "test-hand", 0, 1) }, 1).state
    expect(h.seats[0]).toMatchObject({ stack: 0, total: 1000, nominalTotal: 1100, allIn: true })
    h = resolve(h, { kind: "bet", seatNo: 1, decision: { action: "call" }, controlVersion: 1, expectedPaymentVersion: betPaymentVersion(h, 1, "test-hand", 1, 1) }, 2).state
    expect(h.street).toBe("settled"); expect(h.seats.reduce((n, s) => n + s.stack, 0)).toBe(2000); assertHandIntegrity(h)
  })
})
