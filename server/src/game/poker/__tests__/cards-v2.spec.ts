import { describe, expect, it } from "vitest"
import type { PokerCardChooseInput, PokerCardPlayInput } from "@synapse/shared/game-contracts"
import { projectCardView, projectResolutionFrame } from "../poker-card-projection"
import { createCardRegistry } from "../engine/cards/catalog-v1"
import { CARD_CATALOG_V2_SNAPSHOT, createCardRegistryV2 } from "../engine/cards/catalog-v2"
import { quoteCardPlay } from "../engine/cards/commands"
import { orderedDeck } from "../engine/deck"
import type { Decision } from "../engine/betting"
import { betPaymentVersion } from "../engine/chips/funded-betting"
import { assertHandIntegrity, handPotAmount, quoteRoll, startHand, type HandState } from "../engine/hand-runner"
import { resolveHandCommand, type HandCommand } from "../engine/resolve-hand"
import { cardContext, sequenceRandomInt } from "./card-test-fixtures"

const catalog = createCardRegistryV2()
const handId = "test-hand"

function resolve(h: HandState, command: HandCommand, seq: number, entropy: number[] = [], nowMs = 0) {
  const actor = h.participants!.find(p => p.seatNo === h.actionOnSeat)
  return resolveHandCommand(h, command, cardContext({
    actionSeq: seq, rootActionId: `root-${seq}`, actorSeatNo: actor?.seatNo ?? null, actorAdmissionId: actor?.admissionId ?? null,
    randomInt: sequenceRandomInt(entropy), source: command.kind === "hand.start" ? "system" : command.kind === "timeout" ? "timeout" : "human", nowMs,
  }), createCardRegistry())
}

function start(stacks = [1000, 1000], prefix: string[] = []) {
  const deck = [...prefix, ...orderedDeck().filter(card => !prefix.includes(card))]
  const h = startHand(stacks.map((stack, seatNo) => ({ stack, seatNo })), 0, deck, {
    cardRulesVersion: "cards-v2", chipRulesVersion: "chips-v2", ruleOptions: { cards: true },
  }, { deferProgress: true })
  h.participants = h.seats.map(p => ({ admissionId: `admission-${p.seatNo}`, userId: `user-${p.seatNo}`, seatNo: p.seatNo, kind: "human" }))
  return resolve(h, { kind: "hand.start" }, 0).state
}

function action(h: HandState, seq: number) {
  if (h.street === "settled") throw new Error("fixture hand settled")
  return {
    roomCode: "1234", handId, street: h.street, expectedActionSeq: seq - 1, controlVersion: 1,
    actionId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  }
}

function cardPlay(h: HandState, id: string, seq: number, selections: PokerCardPlayInput["selections"] = {}) {
  const owner = h.participants!.find(p => p.seatNo === h.actionOnSeat)!
  const hand = h.cards!.hands[owner.admissionId]
  let instance = hand.find(card => card.definitionId === id)
  if (!instance) {
    const index = h.cards!.pool.findIndex(card => card.definitionId === id)
    if (index < 0) throw new Error("fixture ability pool empty")
    instance = h.cards!.pool.splice(index, 1)[0]
    hand.push(instance)
  }
  const preview = { ...action(h, seq), instanceId: instance.id, selections }
  const quote = quoteCardPlay(h, preview, catalog)
  return { input: { ...preview, expectedPaymentVersion: quote.version }, quote }
}

function choose(h: HandState, seq: number, candidateIndex: number) {
  const pending = h.cards!.pending!
  const input: PokerCardChooseInput = { ...action(h, seq), choiceId: pending.id, expectedPaymentVersion: pending.paymentVersion, candidateIndex }
  return resolve(h, { kind: "card.choose", input }, seq)
}

function bet(h: HandState, seq: number, decision: Decision) {
  const seatNo = h.actionOnSeat!
  return resolve(h, { kind: "bet", seatNo, decision, controlVersion: 1, expectedPaymentVersion: betPaymentVersion(h, seatNo, handId, seq - 1, 1) }, seq).state
}

function cardView(h: HandState, seatNo: number, seq: number) {
  return projectCardView(h, { audience: "desktop", perspective: "owner", actionSeq: seq, handId, nowMs: 0,
    self: { ...h.participants!.find(p => p.seatNo === seatNo)!, controlVersion: 1 } })!
}

describe("新版能力牌", () => {
  it("只发八种牌，保留冻结规则和逐牌取消策略", () => {
    const h = start()
    expect(h.cards).toMatchObject({ version: "cards-v2", catalogSnapshot: CARD_CATALOG_V2_SNAPSHOT, initialCount: 64 })
    expect(catalog.all().map(card => [card.id, card.artId, card.play?.cancelUntil, card.play?.candidates])).toEqual([
      ["01", "v1/01", "target-confirm", undefined], ["02", "v1/02", "never", undefined],
      ["06", "v1/06", "target-confirm", 3], ["07", "v1/07", "never", 5],
      ["11", "v1/11", "never", undefined], ["14", "v1/14", "target-confirm", undefined],
      ["22", "v1/22", "never", undefined], ["48", "v1/48", "never", undefined],
    ])
    expect(createCardRegistry().get("07").name).toBe("择高而留")
    expect(quoteRoll(h, 0).enabled).toBe(false)
    expect(h.reserve).toBeUndefined()
  })

  it("加注和本手换牌会刷新报价，扣款只增加主池，支付后至少剩一枚筹码", () => {
    let h = start()
    const before = cardPlay(h, "01", 1, { hole: 0 })
    expect(before.quote.paidAmount).toBe(1)
    h = bet(h, 1, { action: "call" })
    h = bet(h, 2, { action: "raise", to: 400 })
    const after = cardPlay(h, "01", 3, { hole: 0 })
    expect(after.quote.paidAmount).toBe(3)
    expect(() => resolve(h, { kind: "card.play", input: { ...after.input, expectedPaymentVersion: before.quote.version } }, 3)).toThrow("POKER_CARD_PRICE_CHANGED")
    const paid = resolve(h, { kind: "card.play", input: after.input }, 3)
    expect(paid.state.seats[0]).toMatchObject({ total: 2, nominalTotal: 2, streetBet: 2, stack: 995 })
    expect(handPotAmount(paid.state)).toBe(handPotAmount(h) + 3)
    expect(paid.state.mainPotFees).toEqual({ 0: 3 })
    expect(paid.frame.events.filter(event => event.type === "chips.paid")).toMatchObject([{ data: { amount: 3, destination: "pot" } }])
    expect(paid.reserveBatch).toBeUndefined()
    expect(paid.state.turnClock).toEqual(h.turnClock)
    expect(cardPlay(paid.state, "01", 4, { hole: 0 }).quote.paidAmount).toBe(5)
    const short = start([2, 1000])
    const shortPlay = cardPlay(short, "01", 1, { hole: 0 })
    expect(cardView(short, 0, 0).ownHand!.find(card => card.instanceId === shortPlay.input.instanceId)?.reason).toBe("POKER_CARD_INSUFFICIENT_STACK")
    expect(() => resolve(short, { kind: "card.play", input: shortPlay.input }, 1)).toThrow("POKER_CARD_INSUFFICIENT_STACK")
    expect(cardView(h, 1, 2).ownHand?.every(card => !card.available)).toBe(true)
    assertHandIntegrity(paid.state)
  })

  it("河牌可连续使用四种换牌，候选在确认付费后才私下揭示且必须选完", () => {
    let h = start()
    h = bet(h, 1, { action: "call" })
    for (let seq = 2; seq <= 6; seq++) h = bet(h, seq, { action: "check" })
    expect(h.street).toBe("river")
    const actor = h.actionOnSeat!
    const old = [...h.seats[actor].hole]
    const deck = [...h.deck]
    let offer = cardPlay(h, "01", 7, { hole: 1 })
    h = resolve(h, { kind: "card.play", input: offer.input }, 7).state
    expect(h.seats[actor].hole).toEqual([old[0], deck[0]])
    offer = cardPlay(h, "06", 8, { hole: 0 })
    const three = resolve(h, { kind: "card.play", input: offer.input }, 8)
    expect(three.state.cards?.pending).toMatchObject({ cardIndex: 0, sourceCardId: "06" })
    expect(new Set(three.state.cards?.pending?.candidates).size).toBe(3)
    expect(cardView(three.state, actor, 8).definitions?.["06"].play?.candidates).toBe(3)
    expect(cardView(three.state, 1 - actor, 8).pending).toBeNull()
    expect(() => bet(three.state, 9, { action: "check" })).toThrow("POKER_CARD_CHOICE_REQUIRED")
    h = choose(three.state, 9, 2).state
    expect(h.mainPotFees).toEqual(three.state.mainPotFees)
    expect(h.seats[actor].hole[0]).toBe(three.state.cards!.pending!.candidates[2])

    offer = cardPlay(h, "07", 10)
    const five = resolve(h, { kind: "card.play", input: offer.input }, 10, [1])
    const pending = five.state.cards!.pending!
    expect(pending.cardIndex).toBe(1)
    expect(new Set(pending.candidates).size).toBe(5)
    expect(pending.candidates.every(card => h.deck.includes(card))).toBe(true)
    expect(cardView(five.state, actor, 10).definitions?.["07"]).toMatchObject({ name: "五选其一", artId: "v2/07" })
    expect(projectResolutionFrame(five.frame).events.every(event => !event.cards)).toBe(true)
    const other = cardPlay(five.state, "02", 11)
    expect(() => resolve(five.state, { kind: "card.play", input: other.input }, 11)).toThrow("POKER_CARD_CHOICE_REQUIRED")
    const timeout = resolve(five.state, { kind: "timeout", seatNo: actor }, 11, [], 600000)
    expect(timeout.state.seats[actor].hole[1]).toBe(pending.candidates[0])
    expect(timeout.state.mainPotFees).toEqual(five.state.mainPotFees)
    expect(timeout.state.cardAudit?.used.at(-1)?.status).toBe("completed")
    const cancelled = resolve(five.state, { kind: "hand.cancel", funding: "practice" }, 11).state
    expect(cancelled).toMatchObject({ street: "settled", cancelledChips: 2000, mainPotFees: five.state.mainPotFees, payouts: {} })
    expect(cancelled.seats[actor].hole[1]).toBe(pending.candidates[0])
    expect(cancelled.cardAudit?.pending).toBeNull()
    assertHandIntegrity(cancelled)
    h = choose(five.state, 11, 3).state
    expect(h.seats[actor].hole[1]).toBe(pending.candidates[3])
    expect(h.mainPotFees).toEqual(five.state.mainPotFees)

    const previous = [...h.seats[actor].hole]
    offer = cardPlay(h, "02", 12)
    const double = resolve(h, { kind: "card.play", input: offer.input }, 12).state
    expect(double.seats[actor].hole).toEqual(h.deck.slice(0, 2))
    expect(previous.every(card => double.deck.includes(card))).toBe(true)
    expect(handPotAmount(double)).toBe(handPotAmount(h) + offer.quote.paidAmount)
    assertHandIntegrity(double)
  })

  it("私查与预览的结果只对使用者可见，反制会消耗一次并挡下私查", () => {
    let h = start()
    const preview = cardPlay(h, "11", 1)
    const previewed = resolve(h, { kind: "card.play", input: preview.input }, 1)
    h = previewed.state
    expect(cardView(h, 0, 1).privateResults).toMatchObject([{ cardId: "11", values: [h.deck[1]], valid: true }])
    expect(cardView(h, 1, 1).privateResults).toEqual([])
    expect(projectResolutionFrame(previewed.frame).events.every(event => !event.cards)).toBe(true)
    const shield = cardPlay(h, "48", 2)
    h = resolve(h, { kind: "card.play", input: shield.input }, 2).state
    expect(cardView(h, 0, 2).statuses).toMatchObject([{ cardId: "48", remaining: 1 }])
    const duplicate = cardPlay(h, "48", 3)
    expect(() => resolve(h, { kind: "card.play", input: duplicate.input }, 3)).toThrow("POKER_CARD_COUNTER_ACTIVE")
    h = bet(h, 3, { action: "call" })
    const inspect = cardPlay(h, "14", 4, { player: 0 })
    h = resolve(h, { kind: "card.play", input: inspect.input }, 4).state
    expect(cardView(h, 1, 4).used.at(-1)?.status).toBe("blocked")
    expect(cardView(h, 1, 4).statuses).toEqual([])
    expect(cardView(h, 1, 4).privateResults).toEqual([])
    const next = cardPlay(h, "14", 5, { player: 0 })
    const inspected = resolve(h, { kind: "card.play", input: next.input }, 5)
    expect(cardView(inspected.state, 1, 5).privateResults).toMatchObject([{ cardId: "14", values: h.seats[0].hole }])
    expect(cardView(inspected.state, 0, 5).privateResults?.every(result => result.cardId !== "14")).toBe(true)
    expect(projectResolutionFrame(inspected.frame).events.every(event => !event.cards)).toBe(true)
    const draw = cardPlay(inspected.state, "22", 6)
    const handCount = inspected.state.cards!.hands["admission-1"].length
    const drawn = resolve(inspected.state, { kind: "card.play", input: draw.input }, 6)
    expect(drawn.state.cards!.hands["admission-1"]).toHaveLength(handCount + 1)
    expect(handPotAmount(drawn.state)).toBe(handPotAmount(h))
  })

  it.each([
    { board: ["2c", "7s", "8h", "9d", "Jh"], mainWinners: [1], sideWinners: [2], shares: { 1: 301 } },
    { board: ["Ts", "Js", "Qs", "Ks", "As"], mainWinners: [0, 1, 2], sideWinners: [0, 2], shares: { 0: 100, 1: 101, 2: 100 } },
  ])("主池独赢或平分包含牌费，边池保留原下注资格", ({ board, mainWinners, sideWinners, shares }) => {
    let h = start([300, 100, 300], ["Ah", "Kh", "Qh", "Ad", "Kd", "Qd", "2d", ...board.slice(0, 3), "3d", board[3], "4d", board[4]])
    const offer = cardPlay(h, "01", 1, { hole: 0 })
    // Draw deep in the deck so the predetermined board is still the first five dealt cards.
    const last = h.deck.length - 1
    const keepOrder = [last, ...Array.from({ length: last }, (_, i) => last - i)]
    h = resolve(h, { kind: "card.play", input: offer.input }, 1, keepOrder).state
    h = bet(h, 2, { action: "allin" })
    h = bet(h, 3, { action: "call" })
    h = bet(h, 4, { action: "call" })
    expect(h.board).toEqual(board)
    expect(h.pots).toEqual([
      { amount: 301, eligible: [0, 1, 2], refund: false, winners: mainWinners, shares },
      { amount: 398, eligible: [0, 2], refund: false, winners: sideWinners, shares: sideWinners.length > 1 ? { 0: 199, 2: 199 } : { 2: 398 } },
    ])
    assertHandIntegrity(h)
  })
})
