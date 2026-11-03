import { z } from "zod"
import { isModernPokerCardRules, type PokerCardPlayInput, type PokerCardChooseInput, type PokerRollStartInput, type PokerRollChooseInput, type GameReserveScope } from "@synapse/shared/game-contracts"
import { createCardOperationRegistry, planCardPlay, planCardChoice } from "./cards/commands"
import { CARD_CATALOG_V1_SNAPSHOT } from "./cards/catalog-v1"
import { CARD_CATALOG_V2_SNAPSHOT, CARD_CATALOG_V3_SNAPSHOT, createCardRegistryV2 } from "./cards/catalog-v2"
import { createCardPool, applyCardPoolOperation, invalidatePokerObservations } from "./cards/pool"
import { runResolution } from "./cards/runner"
import type { CardRegistry } from "./cards/registry"
import { CardRuleError, type ResolutionContext, type DomainOperation, type HandResolution } from "./cards/types"
import { applyDeadlineOperation } from "./cards/deadlines"
import { consumeEffects } from "./cards/statuses"
import { applyFundedBet, betPaymentVersion, quoteFundedBet } from "./chips/funded-betting"
import { applyReserveOperation } from "./chips/reserve"
import { applyHandReserveDelta } from "./chips/operations"
import { nextHandTransition } from "./hand-transitions"
import { act, removeFromHand, settleHand, type HandState } from "./hand-runner"
import { quoteRoll, quoteRollChipPayment, drawRoll, chooseRollCard, assertHandIntegrity } from "./roll"
import { after, seatOrder } from "./seat-order"
import type { Decision } from "./betting"

export type HandCommand = { scope?: GameReserveScope } & (
  | { kind: "hand.start" }
  | { kind: "bet"; seatNo: number; decision: Decision; controlVersion: number; expectedPaymentVersion?: string }
  | { kind: "roll.start"; input: PokerRollStartInput }
  | { kind: "roll.choose"; input: PokerRollChooseInput }
  | { kind: "card.play"; input: PokerCardPlayInput }
  | { kind: "card.choose"; input: PokerCardChooseInput }
  | { kind: "timeout" | "participant.leave"; seatNo: number }
  | { kind: "hand.cancel"; funding: "practice" }
)
const empty = z.object({}).strict(), seat = z.object({ seatNo: z.number().int() }).strict()
const operation = (type: string, input: Record<string, unknown> = {}): DomainOperation => ({ type, input })

export function resolveHandCommand(original: HandState, command: HandCommand, context: ResolutionContext, legacyCatalog: CardRegistry): HandResolution {
  assertHandIntegrity(original)
  if (command.kind === "hand.start" && (context.actionSeq !== 0 || original.street !== "preflop" || original.cards || original.reserve || original.turnClock)) throw new CardRuleError("POKER_CARD_STATE_INVALID")
  if (original.cards?.pending && (original.cards.pending.handId !== context.handId || original.cards.pending.street !== original.street)) throw new CardRuleError("POKER_CARD_STATE_INVALID")
  if (original.chipRulesVersion !== "chips-v2") {
    const state = command.kind === "bet" ? act(original, command.seatNo, command.decision) : command.kind === "timeout" || command.kind === "participant.leave" ? removeFromHand(original, command.seatNo) : null
    if (!state) throw new CardRuleError("POKER_CARD_MODE_UNAVAILABLE")
    return { state, frame: { id: `${context.handId}:${context.actionSeq}`, handId: context.handId, seq: context.actionSeq, rootActionId: context.rootActionId, events: [] } }
  }
  const version = original.cardRulesVersion ?? "cards-v1"
  const catalog = isModernPokerCardRules(version) ? createCardRegistryV2(version) : legacyCatalog
  const snapshot = version === "cards-v3" ? CARD_CATALOG_V3_SNAPSHOT : version === "cards-v2" ? CARD_CATALOG_V2_SNAPSHOT : CARD_CATALOG_V1_SNAPSHOT
  if (command.kind !== "hand.start" && original.cards && (original.cards.version !== version || original.cards.catalogSnapshot?.digest !== snapshot.digest)) throw new CardRuleError("POKER_CARD_VERSION_UNSUPPORTED")
  if (!["hand.start", "hand.cancel", "timeout", "participant.leave"].includes(command.kind)) {
    if (original.ruleOptions?.cards && context.source === "mcp") throw new CardRuleError("POKER_CARD_AI_DISABLED")
    const person = original.participants?.find(p => p.admissionId === context.actorAdmissionId && p.seatNo === context.actorSeatNo)
    const actor = original.seats.find(s => s.seatNo === context.actorSeatNo && !s.folded && !s.allIn)
    if (!person || !actor || original.actionOnSeat !== actor.seatNo || command.kind === "bet" && command.seatNo !== actor.seatNo) throw new CardRuleError("POKER_NOT_YOUR_TURN")
    if (!original.turnClock || context.nowMs >= original.turnClock.deadlineAt) throw new CardRuleError("POKER_STALE_ACTION")
  }
  if (command.kind === "hand.cancel" && command.scope && command.scope.funding !== "practice") throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  const registry = createCardOperationRegistry(catalog)
  registry.register({ id: "hand.start", schema: empty, apply(h, _input, api) {
    if (!h.participants || h.participants.length !== h.seats.length) throw new CardRuleError("POKER_CARD_STATE_INVALID")
    if (!isModernPokerCardRules(version)) h.reserve = { revision: 0, lots: [], claims: [], movements: [], finalized: false }
    api.emit("bet.blinds", { amounts: h.seats.map(s => ({ seatNo: s.seatNo, amount: s.total })) }, "public")
    if (h.ruleOptions?.cards) {
      h.cards = createCardPool(catalog.all(), context, version)
      h.cards.catalogSnapshot = structuredClone(snapshot)
      h.cards.participants = h.participants.map(p => ({ ...p, folded: h.seats.find(s => s.seatNo === p.seatNo)!.folded, allIn: h.seats.find(s => s.seatNo === p.seatNo)!.allIn }))
      h.cards = applyCardPoolOperation(h.cards, { kind: "deal", stage: "initial", dealerSeat: h.dealerSeat }, context).state
      for (const person of h.cards.participants.filter(p => p.kind === "human")) {
        api.emit("ability.dealt", { stage: "initial", cards: h.cards.hands[person.admissionId] }, "owner", undefined, person.admissionId)
        api.emit("ability.drawn", { count: h.cards.hands[person.admissionId]?.length ?? 0, reason: "initial" }, "owner", undefined, person.admissionId)
      }
    }
    api.enqueue(operation("hand.advance", { afterSeat: seatOrder(h.seats.map(s => s.seatNo), h.dealerSeat).bigBlind }))
  } })
  registry.register({ id: "turn.end", schema: empty, apply(h, _input, api) {
    if (h.cards && h.turnClock) api.enqueue(operation("ability.turnEnded", { seatNo: h.turnClock.seatNo, turnId: h.turnClock.turnId }))
    else h.turnClock = null
  } })
  registry.register({ id: "turn.start", schema: seat, apply(h, input, api) {
    h.actionOnSeat = input.seatNo
    if (h.turnClock?.seatNo === input.seatNo) return
    const turnId = `${context.handId}:${context.actionSeq}:${input.seatNo}`
    if (h.cards) api.enqueue(operation("ability.turnStarted", { seatNo: input.seatNo, turnId }))
    else {
      h.turnClock = applyDeadlineOperation(null, { kind: "start", seatNo: input.seatNo, turnId }, context.nowMs)
      api.emit("turn.started", { seatNo: input.seatNo, turnId }, "public")
    }
  } })
  registry.register({ id: "hand.advance", schema: z.object({ afterSeat: z.number().int(), preserveSeat: z.number().int().optional() }).strict(), apply(h, input, api) {
    const next = nextHandTransition(h, input.afterSeat)
    if (next.kind === "turn") api.enqueue(operation("turn.start", { seatNo: input.preserveSeat !== undefined && h.seats.some(s => s.seatNo === input.preserveSeat && !s.folded && !s.allIn) ? input.preserveSeat : next.seatNo }))
    else if (next.kind === "settle") api.enqueue(operation("hand.settle", { showdown: next.showdown }))
    else if (next.kind === "street") {
      if (h.cards) api.enqueue(operation("ability.streetEnded", { street: h.street }))
      api.enqueue(operation("poker.dealBoard", { street: next.street, count: next.count }))
      api.enqueue(operation("hand.stageReady"))
    }
  } })
  registry.register({ id: "poker.dealBoard", schema: z.object({ street: z.enum(["flop", "turn", "river"]), count: z.number().int().min(1).max(3) }).strict(), apply(h, input, api) {
    if (h.deck.length < input.count + 1) throw new CardRuleError("POKER_CARD_DECK_EMPTY")
    ;(h.burnedCards ??= []).push(h.deck.shift()!)
    h.board.push(...h.deck.splice(0, input.count)); h.street = input.street; h.currentBet = 0; h.minRaise = h.bigBlind
    for (const p of h.seats) { p.streetBet = 0; p.lastActedBet = null }
    h.actionOnSeat = null; invalidatePokerObservations(h)
    api.emit("street.started", { street: h.street, cards: [...h.board] }, "public")
    assertHandIntegrity(h)
  } })
  registry.register({ id: "hand.stageReady", schema: empty, apply(h, _input, api) {
    if (h.cards && h.seats.filter(s => !s.folded && !s.allIn).length > 1) api.enqueue(operation("hand.refill"))
    api.enqueue(operation("hand.advance", { afterSeat: h.dealerSeat }))
  } })
  registry.register({ id: "hand.refill", schema: empty, apply(h, _input, api) {
    api.enqueue(operation("street.refill", { stage: h.street }))
    api.enqueue(operation("hand.refillFact"))
  } })
  registry.register({ id: "hand.refillFact", schema: empty, apply(h, _input, api) {
    for (const person of h.cards!.participants.filter(p => p.kind === "human" && !p.folded && !p.allIn && p.active !== false)) api.emit("ability.dealt", { stage: h.street }, "owner", undefined, person.admissionId)
  } })
  registry.register({ id: "bet.submit", schema: empty, apply(h, _input, api) {
    if (command.kind !== "bet") throw new Error("POKER_ILLEGAL_ACTION")
    if (h.cards?.pending || h.roll?.pending) throw new CardRuleError("POKER_CARD_CHOICE_REQUIRED")
    const quote = quoteFundedBet(h, command.seatNo, command.decision), version = betPaymentVersion(h, command.seatNo, context.handId, context.actionSeq - 1, command.controlVersion)
    if ((h.ruleOptions?.cards && quote.nominalAmount > 0 || command.expectedPaymentVersion !== undefined) && command.expectedPaymentVersion !== version) throw new CardRuleError("POKER_CARD_PRICE_CHANGED")
    Object.assign(h, applyFundedBet(h, command.seatNo, command.decision, quote))
    if (h.cards) consumeEffects(h, quote.consumedModifierIds)
    api.emit("bet.completed", { targetSeatNo: command.seatNo, amount: quote.paidAmount, nominalAmount: quote.nominalAmount, waivedAmount: quote.waivedAmount }, "public")
    api.enqueue(operation("turn.end")); api.enqueue(operation("hand.advance", { afterSeat: command.seatNo }))
  } })
  registry.register({ id: "hand.settle", schema: z.object({ showdown: z.boolean() }).strict(), apply(h, input, api) {
    Object.assign(h, settleHand(h, input.showdown))
    api.emit("hand.settled", { payouts: h.payouts }, "public")
    api.enqueue(operation("reserve.finalize")); api.enqueue(operation("hand.cleanup"))
  } })
  registry.register({ id: "reserve.finalize", schema: empty, apply(h, _input, api) {
    if (h.reserve && !h.reserve.finalized) {
      const result = applyReserveOperation(h.reserve, { kind: "finalize" }, context, after(h.seats.map(s => s.seatNo), h.dealerSeat))
      applyHandReserveDelta(h, result)
      api.emit("chips.distributed", { amount: result.amount }, "public")
    }
    if (h.roll) h.roll.released = true
  } })
  registry.register({ id: "hand.cleanup", schema: empty, apply(h) {
    if (h.cards) {
      h.cardAudit = structuredClone(h.cards)
      h.cards = applyCardPoolOperation(h.cards, { kind: "clear" }, context).state
      h.cards.publicMarkers = []; h.cards.tideUsed = {}
    }
    h.turnClock = null
  } })
  registry.register({ id: "choice.complete", schema: z.object({ seq: z.number().int() }).strict(), apply(h, input) {
    const record = h.cards?.used.find(c => c.seq === input.seq && c.status === "choice_required")
    if (record) record.status = "completed"
  } })
  registry.register({ id: "hand.forfeit", schema: seat, apply(h, input, api) {
    const player = h.seats.find(s => s.seatNo === input.seatNo)
    if (!player) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    const current = h.actionOnSeat
    player.folded = true
    if (current === input.seatNo) api.enqueue(operation("turn.end"))
    api.enqueue(operation("hand.advance", { afterSeat: input.seatNo, ...(current !== null && current !== input.seatNo ? { preserveSeat: current } : {}) }))
  } })
  registry.register({ id: "hand.discard", schema: empty, apply(h, _input, api) {
    h.cancelledChips = h.seats.reduce((n, s) => n + s.startingStack, 0)
    for (const player of h.seats) { player.stack = 0; player.total = 0; player.nominalTotal = 0; player.streetBet = 0 }
    h.street = "settled"; h.actionOnSeat = null; h.turnClock = null
    api.emit("chips.discarded", { amount: h.cancelledChips }, "public")
    api.enqueue(operation("hand.cleanup"))
  } })
  registry.register({ id: "roll.draw", schema: z.object({ seatNo: z.number().int(), rollId: z.string(), kind: z.enum(["normal", "super"]), cardIndex: z.number().int(), fee: z.number().int().nonnegative(), nominalFee: z.number().int().nonnegative(), paymentVersion: z.string() }).strict(), apply(h, input) {
    Object.assign(h, drawRoll(h, input.seatNo, { ...input, sourceActionSeq: context.actionSeq }, context.randomInt))
  } })
  registry.register({ id: "roll.select", schema: z.object({ seatNo: z.number().int(), rollId: z.string(), index: z.number().int() }).strict(), apply(h, input) { Object.assign(h, chooseRollCard(h, input.seatNo, input.rollId, input.index, context.randomInt)) } })
  let operations: readonly DomainOperation[]
  if (command.kind === "hand.start") operations = [operation("hand.start")]
  else if (command.kind === "bet") operations = [operation("bet.submit")]
  else if (command.kind === "card.play") operations = planCardPlay(original, command.input, context, catalog)
  else if (command.kind === "card.choose") operations = [...planCardChoice(original, command.input, context, catalog), operation("choice.complete", { seq: original.cards!.pending!.sourceActionSeq })]
  else if (command.kind === "roll.start") {
    const input = command.input, actor = context.actorSeatNo!
    if (input.handId !== context.handId || input.expectedActionSeq !== context.actionSeq - 1 || input.street !== original.street) throw new CardRuleError("POKER_STALE_ACTION")
    const quote = quoteRoll(original, actor), offer = quote[input.kind]
    if (!offer?.available || offer.fee !== input.expectedFee) throw new CardRuleError(offer?.reason ?? "POKER_ROLL_PRICE_CHANGED")
    const payment = quoteRollChipPayment(original, actor, offer.fee)
    if ((original.ruleOptions?.cards && context.source === "human" || input.expectedPaymentVersion !== undefined) && input.expectedPaymentVersion !== payment.version) throw new CardRuleError("POKER_CARD_PRICE_CHANGED")
    operations = [operation("chips.pay", { seatNo: actor, nominalAmount: payment.nominalAmount, purpose: "roll", revision: payment.revision, version: payment.version, components: payment.components, surchargeIds: [] }), operation("roll.draw", { seatNo: actor, rollId: input.actionId, kind: input.kind, cardIndex: input.cardIndex, fee: payment.paidAmount, nominalFee: payment.nominalAmount, paymentVersion: payment.version })]
  } else if (command.kind === "roll.choose") operations = [operation("roll.select", { seatNo: context.actorSeatNo!, rollId: command.input.rollId, index: command.input.candidateIndex })]
  else {
    const pending = original.cards?.pending, roll = original.roll?.pending, choices: DomainOperation[] = []
    const finishChoice = command.kind !== "participant.leave" || (pending?.ownerSeatNo ?? roll?.seatNo) === command.seatNo || original.seats.filter(s => !s.folded && s.seatNo !== command.seatNo).length <= 1
    if (pending && finishChoice) choices.push(operation(pending.kind === "poker" ? "poker.choose" : "ability.choose", { admissionId: pending.ownerAdmissionId, choiceId: pending.id, index: 0 }), operation("choice.complete", { seq: pending.sourceActionSeq }))
    else if (roll && finishChoice) choices.push(operation("roll.select", { seatNo: roll.seatNo, rollId: roll.id, index: 0 }))
    operations = command.kind === "hand.cancel" ? [...choices, operation("reserve.finalize"), operation("hand.discard")] : [...choices, operation("hand.forfeit", { seatNo: command.seatNo })]
  }
  const result = runResolution(original, operations, context, registry)
  if (command.kind === "card.play") {
    const definition = catalog.get(original.cards!.hands[context.actorAdmissionId!]!.find(c => c.id === command.input.instanceId)!.definitionId)
    const primary = new Set(definition.steps.some(s => s.type === "poker.revealAll") ? ["poker.reveal"] : definition.steps.some(s => s.type === "poker.randomExchange") ? ["poker.exchange"] : definition.steps.map(s => s.type))
    const facts = result.frame.events.filter(e => e.cardId === definition.id && primary.has(e.type) && e.id.endsWith(":fact"))
    const blocked = result.frame.events.some(e => e.cardId === definition.id && (e.type === "ability.resolve" && e.status === "blocked" || e.type === "ability.blocked" || e.type === "chips.stolen" && e.data.status === "blocked")) || facts.length > 0 && facts.every(e => e.status === "blocked")
    const used = result.state.cards!.used.find(c => c.seq === context.actionSeq)!
    used.status = blocked ? "blocked" : result.state.cards!.pending ? "choice_required" : "completed"
    if (result.state.cards!.pending) result.state.cards!.pending.sourceInstanceId = command.input.instanceId
  }
  assertHandIntegrity(result.state)
  if (command.scope && result.state.reserve?.lots.length && result.state.reserve.revision !== (original.reserve?.revision ?? 0)) result.reserveBatch = { scope: command.scope, expectedRevision: original.reserve?.revision ?? 0, revision: result.state.reserve.revision, lots: result.state.reserve.lots, claims: result.state.reserve.claims, movements: result.state.reserve.movements.slice(original.reserve?.movements.length ?? 0) }
  return result
}
