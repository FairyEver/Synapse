import type { PokerCardDefinitionView, PokerCardView, PokerResolutionFrameView, PokerResolutionEventView } from "@synapse/shared/game-contracts"
import type { HandState } from "./engine/hand-runner"
import { createCardRegistry } from "./engine/cards/catalog-v1"
import { cardChoices, cardRequirementError, quoteCardPlay } from "./engine/cards/commands"
import type { ResolutionFrame } from "./engine/cards/types"
import type { CardModeState } from "./engine/cards/pool"

export interface CardViewPolicy {
  audience: "desktop" | "decision"; perspective: "owner" | "public"; handId: string; actionSeq: number; nowMs: number
  self?: { userId: string; admissionId: string; seatNo: number; controlVersion: number }
}
export function projectCardView(state: HandState | { archived: true; cards: CardModeState; seats: { seatNo: number; hole: string[] }[]; street: string }, policy: CardViewPolicy): PokerCardView | undefined {
  const cards = state.cards
  if (!cards) return undefined
  const registry = createCardRegistry(), name = (id: string) => registry.get(id).name
  const view: PokerCardView = { enabled: true, version: cards.version,
    used: cards.used.map(c => ({ id: c.id, cardId: c.cardId, name: name(c.cardId), seatNo: c.seatNo, seq: c.seq, status: c.status })),
    statuses: cards.effects.filter(e => e.remaining === null || e.remaining > 0).map(e => ({ id: e.id, cardId: e.cardId, title: name(e.cardId), polarity: e.polarity, dispellable: e.dispellable,
      ...(e.targetSeatNo !== undefined ? { seatNo: e.targetSeatNo } : {}), ...(e.remaining === null ? {} : { remaining: e.remaining }), ...(e.expiresStreet ? { expiresStreet: e.expiresStreet } : {}) })),
  }
  for (const marker of cards.publicMarkers ?? []) {
    const holder = state.seats.find(s => s.hole.includes(marker.card))
    if (holder && (!marker.expiresStreet || marker.expiresStreet === state.street)) view.statuses.push({ id: marker.id, cardId: marker.cardId, title: name(marker.cardId), polarity: "negative", seatNo: holder.seatNo, dispellable: marker.dispellable, ...(marker.expiresStreet ? { expiresStreet: marker.expiresStreet } : {}) })
  }
  const self = policy.audience === "desktop" && policy.perspective === "owner" && policy.self
    ? cards.participants.find(p => p.kind === "human" && p.userId === policy.self!.userId && p.admissionId === policy.self!.admissionId && p.seatNo === policy.self!.seatNo) : undefined
  if (!self) return view
  if ("archived" in state) {
    view.ownHand = []; view.definitions = {}; view.pending = null
    view.privateResults = cards.privateResults.filter(r => r.ownerAdmissionId === self.admissionId).map(r => ({ id: r.id, cardId: r.cardId, label: r.label, values: [...r.values], valid: r.valid }))
    return view
  }
  const seat = state.seats.find(s => s.seatNo === self.seatNo), definitions: Record<string, PokerCardDefinitionView> = {}
  const definitionView = (id: string): PokerCardDefinitionView => {
    const definition = registry.get(id)
    return { id, name: definition.name, description: definition.description, artId: definition.artId, cost: (definition.costBB ?? 0) * state.bigBlind }
  }
  view.ownHand = (cards.hands[self.admissionId] ?? []).map(instance => {
    const definition = registry.get(instance.definitionId)
    definitions[definition.id] ??= definitionView(definition.id)
    const quote = quoteCardPlay(state, { instanceId: instance.id, handId: policy.handId, expectedActionSeq: policy.actionSeq, controlVersion: policy.self!.controlVersion }, registry)
    const choices = cardChoices(state, definition, self.admissionId, instance.id, registry)
    const reason = !seat || seat.folded || seat.allIn || state.actionOnSeat !== self.seatNo || state.street === "settled" ? "POKER_NOT_YOUR_TURN"
      : !state.turnClock || policy.nowMs >= state.turnClock.deadlineAt ? "POKER_ACTION_EXPIRED"
      : cards.pending || state.roll?.pending ? "POKER_CARD_CHOICE_REQUIRED" : !quote.satisfied ? "POKER_CARD_INSUFFICIENT_STACK"
      : choices.some(c => !c.options.length) ? "POKER_CARD_INVALID_SELECTION" : cardRequirementError(state, definition, self.admissionId, policy.actionSeq + 1)
    return { instanceId: instance.id, cardId: definition.id, available: !reason, ...(reason ? { reason } : {}), payment: { nominalAmount: quote.nominalAmount, waivedAmount: quote.waivedAmount, paidAmount: quote.paidAmount, version: quote.version }, choices }
  })
  view.definitions = definitions
  const pending = cards.pending?.ownerAdmissionId === self.admissionId ? cards.pending : null
  view.pending = pending ? { choiceId: pending.id, kind: pending.kind, origin: pending.origin, paymentVersion: pending.paymentVersion, candidates: [...pending.candidates],
    ...(pending.sourceCardId ? { sourceCardId: pending.sourceCardId } : {}), ...(pending.cardIndex === undefined ? {} : { cardIndex: pending.cardIndex }),
    ...(pending.kind === "ability" ? { candidateCards: cards.reserved.map(c => definitionView(c.definitionId)) } : {}) } : null
  view.privateResults = cards.privateResults.filter(r => r.ownerAdmissionId === self.admissionId).map(r => ({ id: r.id, cardId: r.cardId, label: r.label, values: [...r.values], valid: r.valid }))
  return view
}
const PUBLIC_FACTS = new Set(["ability.played", "ability.statusInstalled", "ability.statusRemoved", "ability.blocked", "poker.revealed", "poker.guessed", "poker.sparked", "chips.paid", "chips.deposited", "chips.stolen", "chips.refunded", "chips.distributed", "chips.discarded", "bet.completed", "bet.blinds", "turn.started", "street.started", "hand.settled"])
const amount = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0
/** Private observations stay in the owner's panel, never in the shared animation feed. */
export function projectResolutionFrame(frame: ResolutionFrame): PokerResolutionFrameView {
  return { id: frame.id, handId: frame.handId, seq: frame.seq, events: frame.events.filter(e => e.audience === "public" && PUBLIC_FACTS.has(e.type)).map(e => {
    const view: PokerResolutionEventView = { index: e.index, type: e.type }
    if (amount(e.actorSeatNo)) view.actorSeatNo = e.actorSeatNo
    if (amount(e.data.targetSeatNo)) view.targetSeatNo = e.data.targetSeatNo
    if (e.cardId && /^(0[1-9]|[1-5][0-9]|60)$/.test(e.cardId)) view.cardId = e.cardId
    for (const key of ["amount", "nominalAmount", "waivedAmount", "count"] as const) if (amount(e.data[key])) view[key] = e.data[key]
    if (e.status) view.status = e.status
    if (["completed", "blocked", "choice_required"].includes(String(e.data.status))) view.status = String(e.data.status)
    if (["poker.revealed", "street.started"].includes(e.type) && Array.isArray(e.data.cards) && e.data.cards.every(c => typeof c === "string" && /^[2-9TJQKA][shdc]$/.test(c))) view.cards = [...e.data.cards] as string[]
    if (e.type === "poker.guessed") {
      if (e.data.color === "red" || e.data.color === "black") view.color = e.data.color
      if (typeof e.data.matched === "boolean") view.matched = e.data.matched
    }
    return view
  }) }
}
export function pageResolutionFrames(frames: readonly ResolutionFrame[], afterSeq: number, limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !amount(afterSeq)) throw new Error("POKER_INVALID_CURSOR")
  const ordered = frames.filter(f => f.seq > afterSeq).sort((a, b) => a.seq - b.seq)
  const page = ordered.slice(0, limit)
  return { frames: page.map(projectResolutionFrame), hasMore: ordered.length > limit, afterSeq: page.at(-1)?.seq ?? afterSeq }
}
