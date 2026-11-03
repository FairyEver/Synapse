import { z } from "zod"
import type { PokerCardPlayInput, PokerCardChooseInput, PokerCardChoiceSpec } from "@synapse/shared/game-contracts"
import type { HandState } from "../hand-runner"
import { after } from "../seat-order"
import { quoteChipPayment } from "../chips/payment"
import { lastReserveDeposit } from "../chips/reserve"
import { registerChipCardOperations } from "../chips/operations"
import { OperationRegistry, type CardRegistry } from "./registry"
import { registerPokerCardOperations, publicHoleCards } from "./poker-operations"
import { registerCardStatusOperations, paymentModifiers, cardSurcharges } from "./statuses"
import { applyCardPoolOperation } from "./pool"
import { CardRuleError, type CardDefinition, type DomainOperation, type ResolutionContext } from "./types"

function own(h: HandState, input: Pick<PokerCardPlayInput, "instanceId">, admissionId: string, registry: CardRegistry) {
  const instance = h.cards?.hands[admissionId]?.find(c => c.id === input.instanceId)
  if (!instance) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  return { instance, definition: registry.get(instance.definitionId) }
}
export function quoteCardPlay(h: HandState, input: Pick<PokerCardPlayInput, "instanceId" | "handId" | "expectedActionSeq" | "controlVersion">, registry: CardRegistry) {
  const person = h.cards?.participants.find(p => h.cards?.hands[p.admissionId]?.some(c => c.id === input.instanceId))
  if (!person) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  const { definition } = own(h, input, person.admissionId, registry), seat = h.seats.find(s => s.seatNo === person.seatNo)!
  const surcharge = cardSurcharges(h, person.seatNo, definition.ignoreSurcharges)
  const components = [{ source: "base", amount: (definition.costBB ?? 0) * h.bigBlind }, { source: "surcharge", amount: surcharge.amount }]
  const revision = JSON.stringify([input.handId, input.expectedActionSeq, input.controlVersion, input.instanceId, h.cardRulesVersion])
  return { ...quoteChipPayment({ payerId: person.admissionId, resource: "chips", purpose: "card", nominalAmount: components.reduce((n, c) => n + c.amount, 0), balance: seat.stack, revision, components }, paymentModifiers(h, person.seatNo)), revision, components, surchargeIds: surcharge.effectIds }
}
export function cardChoices(h: HandState, definition: CardDefinition, admissionId: string, instanceId: string, registry: CardRegistry): PokerCardChoiceSpec[] {
  const self = h.cards!.participants.find(p => p.admissionId === admissionId)!
  return definition.selections.map(selection => {
    let options: PokerCardChoiceSpec["options"] = []
    if (selection.kind === "color") options = [{ value: "red", label: "红色" }, { value: "black", label: "黑色" }]
    else if (selection.target === "other_hidden_hole") options = h.seats.filter(s => !s.folded && s.seatNo !== self.seatNo).flatMap(s => s.hole.flatMap((c, index) => publicHoleCards(h, s.seatNo).includes(c) ? [] : [{ value: `${s.seatNo}:${index}`, label: `座位${s.seatNo + 1} · 底牌${index + 1}` }]))
    else if (selection.kind === "hole") options = [0, 1].map(index => ({ value: String(index), label: `底牌${index + 1}` }))
    else if (selection.kind === "player") options = h.cards!.participants.filter(p => p.seatNo !== self.seatNo && h.seats.some(s => s.seatNo === p.seatNo && !s.folded)
      && (selection.target !== "other_human" || p.kind === "human") && (!definition.requirements?.includes("target_holds_ability") || (h.cards!.hands[p.admissionId]?.length ?? 0) > 0))
      .map(p => ({ value: String(p.seatNo), label: `座位${p.seatNo + 1}` }))
    else if (selection.kind === "ability") options = (h.cards!.hands[admissionId] ?? []).filter(c => c.id !== instanceId).map(c => ({ value: c.id, label: registry.get(c.definitionId).name }))
    else if (selection.kind === "status") {
      const seatLabel = (seatNo: number) => `座位${seatNo + 1}${seatNo === self.seatNo ? "（本人）" : ""}`
      options = h.cards!.effects.filter(e => e.dispellable && (selection.target !== "own_negative" || e.ownerAdmissionId === admissionId && e.polarity === "negative" && e.targetSeatNo !== undefined))
        .map(e => ({ value: e.id, label: `${e.targetSeatNo === undefined ? "全场" : seatLabel(e.targetSeatNo)} · ${registry.get(e.cardId).name}${e.remaining === null ? "" : ` · 剩余${e.remaining}次`}` }))
      options.push(...(h.cards!.publicMarkers ?? []).filter(m => m.dispellable && h.seats.some(s => s.hole.includes(m.card) && (selection.target !== "own_negative" || s.seatNo === self.seatNo)))
        .map(m => {
          const holder = h.seats.find(s => s.hole.includes(m.card))!
          return { value: m.id, label: `${seatLabel(holder.seatNo)} · 底牌${holder.hole.indexOf(m.card) + 1} · ${registry.get(m.cardId).name}` }
        }))
      const counts = new Map<string, number>(), positions = new Map<string, number>()
      for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1)
      options = options.map(option => {
        if (counts.get(option.label) === 1) return option
        const position = (positions.get(option.label) ?? 0) + 1
        positions.set(option.label, position)
        return { ...option, label: `${option.label} · 第${position}个` }
      })
    }
    return { key: selection.key, label: selection.label, kind: selection.kind, options }
  })
}
function validateActor(h: HandState, input: PokerCardPlayInput | PokerCardChooseInput, context: ResolutionContext) {
  if (!h.cards || h.cardRulesVersion !== "cards-v1" || !h.ruleOptions?.cards) throw new CardRuleError("POKER_CARD_MODE_UNAVAILABLE")
  if (context.source !== "human") throw new CardRuleError("POKER_CARD_AI_DISABLED")
  const person = h.cards.participants.find(p => p.admissionId === context.actorAdmissionId && p.seatNo === context.actorSeatNo && p.kind === "human")
  const seat = h.seats.find(s => s.seatNo === context.actorSeatNo && !s.folded && !s.allIn)
  if (!person || !seat || h.actionOnSeat !== seat.seatNo || h.street === "settled") throw new CardRuleError("POKER_CARD_NOT_YOUR_TURN")
  if (input.handId !== context.handId || input.street !== h.street || input.expectedActionSeq !== context.actionSeq - 1) throw new CardRuleError("POKER_ACTION_STALE")
  if (!h.turnClock || context.nowMs >= h.turnClock.deadlineAt) throw new CardRuleError("POKER_ACTION_EXPIRED")
  return person
}
function richest(h: HandState, admissionId: string) {
  const order = after(h.seats.map(s => s.seatNo), h.dealerSeat)
  return h.cards!.participants.map(p => ({ ...p, amount: h.reserve?.claims.filter(c => c.admissionId === p.admissionId).reduce((n, c) => n + c.remainingAmount, 0) ?? 0 }))
    .filter(p => p.admissionId !== admissionId && p.amount > 0).sort((a, b) => b.amount - a.amount || order.indexOf(a.seatNo) - order.indexOf(b.seatNo))[0]
}
export function cardRequirementReason(h: HandState, definition: CardDefinition, admissionId: string, seq: number): string | undefined {
  if (definition.excludeRiver && h.street === "river") return "POKER_CARD_RIVER_UNAVAILABLE"
  for (const requirement of definition.requirements ?? []) {
    if (requirement === "deck" && !h.deck.length) return "POKER_CARD_DECK_EMPTY"
    if (requirement === "candidate_pool" && !h.cards!.pool.length) return "POKER_CARD_POOL_EMPTY"
    if (requirement === "stealable" && !richest(h, admissionId)?.amount) return "POKER_CARD_NO_RESERVE_SHARES"
    if (requirement === "recent_deposit" && !lastReserveDeposit(h.reserve ?? { revision: 0, lots: [], claims: [], movements: [], finalized: false }, admissionId, seq)?.remainingAmount) return "POKER_CARD_NO_RECENT_DEPOSIT"
  }
  return undefined
}
export function planCardPlay(h: HandState, input: PokerCardPlayInput, context: ResolutionContext, registry: CardRegistry): readonly DomainOperation[] {
  const person = validateActor(h, input, context)
  if (h.cards!.pending || h.roll?.pending) throw new CardRuleError("POKER_CARD_CHOICE_REQUIRED")
  const { definition } = own(h, input, person.admissionId, registry)
  if (cardRequirementReason(h, definition, person.admissionId, context.actionSeq)) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  const choices = cardChoices(h, definition, person.admissionId, input.instanceId, registry)
  if (Object.keys(input.selections).length !== choices.length || choices.some(c => !c.options.some(o => o.value === String(input.selections[c.key])))) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  const quote = quoteCardPlay(h, input, registry)
  if (quote.version !== input.expectedPaymentVersion) throw new CardRuleError("POKER_CARD_PRICE_CHANGED")
  if (!quote.satisfied) throw new CardRuleError("POKER_CARD_INSUFFICIENT_STACK")
  const targetHole = String(input.selections.targetHole ?? "").split(":"), rich = richest(h, person.admissionId)
  const extra = h.cards!.hands[person.admissionId]?.find(c => c.id === input.selections.ability)
  const values: Record<string, unknown> = { $self: person.seatNo, $admission: person.admissionId, $instance: input.instanceId, $payment: quote.version,
    $hole: Number(input.selections.hole), $player: Number(input.selections.player), $targetSeat: Number(targetHole[0]), $targetSlot: Number(targetHole[1]), $color: input.selections.color,
    $status: input.selections.status, $otherDefinition: extra?.definitionId, $richest: rich?.admissionId, $richestSeat: rich?.seatNo,
    $lastLot: h.reserve && lastReserveDeposit(h.reserve, person.admissionId, context.actionSeq)?.id, $bb2: h.bigBlind * 2, $bb3: h.bigBlind * 3, $bb5: h.bigBlind * 5, $bb10: h.bigBlind * 10 }
  function compile(value: unknown): unknown {
    if (typeof value === "string" && value.startsWith("$")) {
      if (!(value in values) || values[value] === undefined || typeof values[value] === "number" && !Number.isFinite(values[value])) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
      return values[value]
    }
    if (Array.isArray(value)) return value.map(compile)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compile(item)]))
    return value
  }
  const steps = definition.steps.map(s => ({ ...s, cardId: definition.id, input: compile(s.input) as Record<string, unknown> }))
  const target = input.selections.player !== undefined ? Number(input.selections.player) : input.selections.targetHole !== undefined ? Number(targetHole[0]) : definition.requirements?.includes("stealable") && definition.tags.includes("single") ? rich?.seatNo : undefined
  return [
    { type: "chips.pay", input: { seatNo: person.seatNo, nominalAmount: quote.nominalAmount, purpose: "card", revision: quote.revision, version: quote.version, components: quote.components, surchargeIds: quote.surchargeIds }, cardId: definition.id },
    { type: "ability.consume", input: { admissionId: person.admissionId, instanceIds: [input.instanceId, ...(definition.consumeSelected ? [String(input.selections.ability)] : [])] }, cardId: definition.id },
    { type: "ability.resolve", input: { steps, hostile: definition.tags.includes("hostile"), singleTarget: definition.tags.includes("single"), ...(target === undefined ? {} : { targetSeatNo: target }) }, cardId: definition.id },
    { type: "ability.recordPlay", input: { instanceId: input.instanceId, cardId: definition.id, seatNo: person.seatNo, paidAmount: quote.paidAmount, nominalAmount: quote.nominalAmount, waivedAmount: quote.waivedAmount }, cardId: definition.id },
    { type: "ability.played", input: { admissionId: person.admissionId, seatNo: person.seatNo }, cardId: definition.id, audience: "public" },
  ]
}
export function planCardChoice(h: HandState, input: PokerCardChooseInput, context: ResolutionContext, _registry: CardRegistry): readonly DomainOperation[] {
  const person = validateActor(h, input, context), pending = h.cards!.pending
  if (!pending || pending.origin !== "card" || pending.ownerAdmissionId !== person.admissionId || pending.id !== input.choiceId || pending.handId !== input.handId || pending.street !== h.street
    || input.expectedPaymentVersion !== pending.paymentVersion || !Number.isInteger(input.candidateIndex) || input.candidateIndex < 0 || input.candidateIndex >= pending.candidates.length) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
  return [{ type: pending.kind === "poker" ? "poker.choose" : "ability.choose", input: { admissionId: person.admissionId, choiceId: pending.id, index: input.candidateIndex }, cardId: pending.sourceCardId }]
}
export function createCardOperationRegistry(catalog: CardRegistry): OperationRegistry<HandState> {
  const registry = new OperationRegistry<HandState>({ effects: h => h.cards?.effects ?? [] })
  registerPokerCardOperations(registry); registerCardStatusOperations(registry); registerChipCardOperations(registry)
  registry.register({ id: "ability.resolve", schema: z.object({ steps: z.array(z.object({ type: z.string(), input: z.record(z.string(), z.unknown()), cardId: z.string().optional() }).strict()), hostile: z.boolean(), singleTarget: z.boolean(), targetSeatNo: z.number().int().optional() }).strict(), apply(_h, input, api) { for (const step of input.steps) api.enqueue(step) } })
  registry.register({ id: "ability.consume", schema: z.object({ admissionId: z.string(), instanceIds: z.array(z.string()) }).strict(), apply(h, input, api) { h.cards = applyCardPoolOperation(h.cards!, { kind: "consume", ...input }, api.context).state } })
  registry.register({ id: "ability.recordPlay", schema: z.object({ instanceId: z.string(), cardId: z.string(), seatNo: z.number().int(), paidAmount: z.number().int().nonnegative(), nominalAmount: z.number().int().nonnegative(), waivedAmount: z.number().int().nonnegative() }).strict(), apply(h, input, api) {
    h.cards!.used.push({ id: api.context.nextId(), ...input, seq: api.context.actionSeq, status: h.cards!.pending ? "choice_required" : "completed" })
  } })
  registry.register({ id: "ability.draw", schema: z.object({ admissionId: z.string(), count: z.number().int().nonnegative().max(1024), reason: z.enum(["card", "trigger", "stage"]) }).strict(), apply(h, input, api) {
    const result = applyCardPoolOperation(h.cards!, { kind: "draw", admissionId: input.admissionId, count: input.count }, api.context); h.cards = result.state
    if (result.drawn.length < input.count && api.operation.cardId) h.cards.privateResults.push({ id: api.context.nextId(), ownerAdmissionId: input.admissionId, cardId: api.operation.cardId, label: "抽卡结果", values: [result.drawn.length ? `仅抽到 ${result.drawn.length} 张，卡牌池已空` : "卡牌池已空，未抽到卡牌"], valid: true })
    api.emit("ability.drawn", { count: result.drawn.length, reason: input.reason, empty: h.cards.pool.length === 0 }, "owner", undefined, input.admissionId)
  } })
  registry.register({ id: "ability.drawAll", schema: z.object({}).strict(), apply(h, _input, api) {
    const order = after(h.seats.map(s => s.seatNo), h.dealerSeat)
    for (const person of h.cards!.participants.filter(p => p.kind === "human" && h.seats.some(s => s.seatNo === p.seatNo && !s.folded && !s.allIn)).sort((a, b) => order.indexOf(a.seatNo) - order.indexOf(b.seatNo))) api.enqueue({ type: "ability.draw", input: { admissionId: person.admissionId, count: 1, reason: "card" }, cardId: api.operation.cardId })
  } })
  registry.register({ id: "ability.generate", schema: z.object({ definitionIds: z.array(z.string()).optional(), randomCount: z.number().int().min(1).max(2).optional() }).strict(), apply(h, input, api) {
    const definitions = input.definitionIds ? [...input.definitionIds] : []
    if (input.randomCount) {
      const eligible = catalog.all().filter(c => !c.tags.includes("generate"))
      for (let i = 0; i < input.randomCount; i++) {
        const index = api.context.randomInt(eligible.length)
        if (!Number.isInteger(index) || index < 0 || index >= eligible.length) throw new CardRuleError("POKER_CARD_INVALID_ENTROPY")
        definitions.push(eligible[index].id)
      }
    }
    h.cards = applyCardPoolOperation(h.cards!, { kind: "generate", definitionIds: definitions }, api.context).state
    api.emit("ability.generated", { definitions }, "owner")
  } })
  registry.register({ id: "ability.peek", schema: z.object({ targetSeatNo: z.number().int() }).strict(), apply(h, input, api) {
    const person = h.cards!.participants.find(p => p.seatNo === input.targetSeatNo && p.kind === "human"), hand = person && h.cards!.hands[person.admissionId]
    if (!hand?.length) throw new CardRuleError("POKER_CARD_INVALID_SELECTION")
    const index = api.context.randomInt(hand.length)
    if (!Number.isInteger(index) || index < 0 || index >= hand.length) throw new CardRuleError("POKER_CARD_INVALID_ENTROPY")
    const values = [hand[index].definitionId]
    h.cards!.privateResults.push({ id: api.context.nextId(), ownerAdmissionId: api.context.actorAdmissionId!, cardId: api.operation.cardId!, label: "能力牌", values, valid: true })
    api.emit("ability.observed", { values }, "owner")
  } })
  registry.register({ id: "ability.candidates", schema: z.object({ admissionId: z.string(), paymentVersion: z.string(), sourceInstanceId: z.string() }).strict(), apply(h, input, api) {
    if (h.cards!.pending || h.roll?.pending) throw new CardRuleError("POKER_CARD_CHOICE_REQUIRED")
    h.cards = applyCardPoolOperation(h.cards!, { kind: "reserve", ...input, count: 3, choiceId: api.context.nextId(), street: h.street, sourceCardId: api.operation.cardId }, api.context).state
  } })
  registry.register({ id: "ability.choose", schema: z.object({ admissionId: z.string(), choiceId: z.string(), index: z.number().int().nonnegative() }).strict(), apply(h, input, api) {
    h.cards = applyCardPoolOperation(h.cards!, { kind: "choose", ...input }, api.context).state
  } })
  registry.register({ id: "poker.revealAll", schema: z.object({}).strict(), apply(h, _input, api) {
    const parent = h.cards!.effects.find(e => e.kind === "reveal_field")
    for (const seat of h.seats.filter(s => !s.folded)) api.enqueue({ type: "poker.reveal", input: { seatNo: seat.seatNo, duration: "street", parentEffectId: parent?.id }, cardId: api.operation.cardId })
  } })
  registry.register({ id: "street.refill", schema: z.object({ stage: z.enum(["flop", "turn", "river"]), extra: z.number().int().nonnegative().optional() }).strict(), apply(h, input, api) {
    if (h.cards!.dealtStages.includes(input.stage)) return
    const counts = new Map(Object.entries(h.cards!.hands).map(([id, cards]) => [id, cards.length]))
    for (const p of h.cards!.participants) { const seat = h.seats.find(s => s.seatNo === p.seatNo)!; p.folded = seat.folded; p.allIn = seat.allIn }
    h.cards = applyCardPoolOperation(h.cards!, { kind: "deal", stage: input.stage, dealerSeat: h.dealerSeat }, api.context).state
    const order = after(h.seats.map(s => s.seatNo), h.dealerSeat)
    for (let n = 0; n < (input.extra ?? 0); n++) for (const person of h.cards!.participants.filter(p => p.kind === "human" && !p.folded && !p.allIn && p.active !== false).sort((a, b) => order.indexOf(a.seatNo) - order.indexOf(b.seatNo))) h.cards = applyCardPoolOperation(h.cards!, { kind: "draw", admissionId: person.admissionId, count: 1 }, api.context).state
    for (const person of h.cards!.participants.filter(p => p.kind === "human" && !p.folded && !p.allIn && p.active !== false)) api.emit("ability.drawn", { count: (h.cards!.hands[person.admissionId]?.length ?? 0) - (counts.get(person.admissionId) ?? 0), reason: "stage" }, "owner", undefined, person.admissionId)
  } })
  return registry
}
