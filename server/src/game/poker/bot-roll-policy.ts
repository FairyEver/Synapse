import { orderedDeck } from "./engine/deck"
import { evaluate } from "./engine/hand"
import { quoteRoll, type HandState, type RollKind, type RollQuote } from "./engine/hand-runner"
import { rollFinancials } from "./engine/roll"
import type { PokerVariant } from "./engine/rules"
export interface BotRollObservation {
  variant: PokerVariant
  street: HandState["street"]
  seatNo: number
  hole: string[]
  board: string[]
  liveCount: number
  originalPlayerCount: number
  burnedCount: number
  remainingDeckCount: number
  history: { seatNo: number; kind: RollKind; fee: number; count: number }[]
  privateHistory: { ordinal: number; boardCount: number; oldCard: string; candidates: string[]; selectedIndex: number }[]
  effectivePot: number
  effectiveFuture: number
  bigBlind: number
  stack: number
  quote: RollQuote
  pending: { rollId: string; cardIndex: number; candidates: string[] } | null
}
/** Explicit privacy boundary. The policy never receives a HandState or opponent holes. */
export function botRollObservation(state: HandState, seatNo: number): BotRollObservation {
  const p = state.seats.find(s => s.seatNo === seatNo)
  if (!p) throw new Error("POKER_ROLL_SEAT_INVALID")
  const pending = state.roll?.pending
  return {
    variant: state.variant, street: state.street, seatNo, hole: [...p.hole], board: [...state.board],
    liveCount: state.seats.filter(s => !s.folded).length, originalPlayerCount: state.seats.length,
    burnedCount: state.burnedCards?.length ?? Math.max(0, state.board.length - 2), remainingDeckCount: state.deck.length,
    history: (state.roll?.history ?? []).map(({ seatNo, kind, fee, count }) => ({ seatNo, kind, fee, count })),
    privateHistory: (state.roll?.history ?? []).flatMap((h, ordinal) => h.seatNo === seatNo && h.selectedIndex !== null ? [{ ordinal, boardCount: h.street === "preflop" ? 0 : h.street === "flop" ? 3 : 4, oldCard: h.oldCard, candidates: [...h.candidates], selectedIndex: h.selectedIndex }] : []),
    ...rollFinancials(state, seatNo), bigBlind: state.bigBlind, stack: p.stack, quote: quoteRoll(state, seatNo),
    pending: pending?.seatNo === seatNo ? { rollId: pending.id, cardIndex: pending.cardIndex, candidates: [...pending.candidates] } : null,
  }
}
/** The research's finite visible-card heuristic, using the production evaluator for made hands. */
function visibleStrength(hole: readonly string[], board: readonly string[], variant: PokerVariant): number {
  const values = hole.map(c => "23456789TJQKA".indexOf(c[0]) + 2).sort((a, b) => b - a)
  if (board.length < 3) {
    const low = variant === "short32" ? 7 : 2, span = 14 - low
    return Math.min(.985, .16 + .36 * (values[0] - low) / span + .20 * (values[1] - low) / span + (values[0] === values[1] ? .29 : 0) + (hole[0][1] === hole[1][1] ? .035 : 0) + (Math.abs(values[0] - values[1]) <= 2 ? .025 : 0))
  }
  const cards = [...hole, ...board], rank = evaluate(cards, variant)
  const levels = [.14, .52, .72, .82, .88, .93, .96, .98, .995, .999]
  let score = levels[rank.category] + .09 * rank.kickers.reduce((sum, k, i) => sum + k / 15 ** (i + 1), 0)
  if (board.length < 5) {
    if (Math.max(...[..."shdc"].map(s => cards.filter(c => c[1] === s).length)) === 4) score += .035
    const ranks = new Set(cards.map(c => "23456789TJQKA".indexOf(c[0]) + 2))
    if (ranks.has(14)) ranks.add(variant === "short32" ? 6 : 1)
    for (let low = variant === "short32" ? 6 : 1; low <= 10; low++)
      if (Array.from({ length: 5 }, (_, i) => ranks.has(low + i)).filter(Boolean).length === 4) { score += .025; break }
  }
  return Math.min(.9999, score)
}
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i
  return result
}
function candidateWeights(o: BotRollObservation): { card: string; weight: number; known: boolean }[] {
  const unavailable = new Set([...o.hole, ...o.board])
  const unknown = orderedDeck(o.variant).filter(c => !unavailable.has(c))
  const lastOther = o.history.reduce((n, h, i) => h.seatNo !== o.seatNo ? i : n, -1), certain = new Set<string>()
  for (const h of o.privateHistory) {
    if (h.ordinal <= lastOther || h.boardCount !== o.board.length) continue
    certain.add(h.oldCard)
    h.candidates.forEach((c, i) => { if (i !== h.selectedIndex) certain.add(c) })
  }
  for (const c of unavailable) certain.delete(c)
  const physical = o.remainingDeckCount
  if (physical < 3 || certain.size > physical) throw new Error("POKER_BOT_ROLL_OBSERVATION_INVALID")
  const unknownWeight = unknown.length === certain.size ? 0 : (physical - certain.size) / ((unknown.length - certain.size) * physical)
  return unknown.map(card => ({ card, known: certain.has(card), weight: certain.has(card) ? 1 / physical : unknownWeight }))
}
function rollOpportunities(o: BotRollObservation): Record<RollKind, { cardIndex: number; gain: number }> {
  const weighted = candidateWeights(o), exponent = Math.max(1, o.liveCount - 1)
  const value = (hole: string[]) => visibleStrength(hole, o.board, o.variant) ** exponent
  const before = value(o.hole), result = { normal: { cardIndex: 0, gain: -Infinity }, super: { cardIndex: 0, gain: -Infinity } }
  for (let cardIndex = 0; cardIndex < 2; cardIndex++) {
    const scores = weighted.map(w => { const h = [...o.hole]; h[cardIndex] = w.card; return { ...w, value: value(h) } }).sort((a, b) => a.value - b.value)
    const ordinary = scores.reduce((sum, w) => sum + w.value * w.weight, 0) - before
    const certain = scores.filter(w => w.known).length, uncertain = scores.length - certain
    let expected = 0
    if (!certain) expected = scores.reduce((sum, w, j) => sum + w.value * choose(j, 2) / choose(scores.length, 3), 0)
    else {
      const mixture = Array.from({ length: 4 }, (_, j) => choose(certain, j) * choose(o.remainingDeckCount - certain, 3 - j) / choose(o.remainingDeckCount, 3))
      let k = 0, u = 0, previous = 0
      for (let i = 0; i < scores.length; i++) {
        if (scores[i].known) k++; else u++
        if (i + 1 < scores.length && scores[i + 1].value === scores[i].value) continue
        let cdf = 0
        for (let j = 0; j <= 3; j++) if (mixture[j] > 0) cdf += mixture[j] * choose(k, j) / choose(certain, j) * choose(u, 3 - j) / choose(uncertain, 3 - j)
        expected += scores[i].value * (cdf - previous); previous = cdf
      }
    }
    if (ordinary > result.normal.gain) result.normal = { cardIndex, gain: ordinary }
    if (expected - before > result.super.gain) result.super = { cardIndex, gain: expected - before }
  }
  return result
}
export function chooseBotRoll(input: BotRollObservation): { kind: RollKind; cardIndex: number; fee: number } | null {
  if (!input.quote.enabled || input.pending || !["preflop", "flop", "turn"].includes(input.street) || (!input.quote.normal.available && !input.quote.super.available)) return null
  const opportunities = rollOpportunities(input)
  let result: ReturnType<typeof chooseBotRoll> = null, best = 0
  for (const kind of ["normal", "super"] as const) {
    const offer = input.quote[kind], opportunity = opportunities[kind]
    if (!offer.available || offer.fee >= input.stack) continue
    const surplus = Math.max(0, opportunity.gain) * (input.effectivePot + .12 * input.effectiveFuture + 2 * input.bigBlind) - 1.25 * offer.fee
    if (surplus > 0 && (surplus > best || (surplus === best && result && (offer.fee < result.fee || (offer.fee === result.fee && kind === "normal" && result.kind === "super"))))) {
      best = surplus; result = { kind, cardIndex: opportunity.cardIndex, fee: offer.fee }
    }
  }
  return result
}
export function chooseBotRollCandidate(input: BotRollObservation, cardIndex: number, candidates: readonly string[]): number {
  if (![0, 1].includes(cardIndex) || !candidates.length) throw new Error("POKER_BOT_ROLL_CHOICE_INVALID")
  let best = 0, score = -Infinity
  candidates.forEach((card, i) => {
    const h = [...input.hole]; h[cardIndex] = card
    const value = visibleStrength(h, input.board, input.variant)
    if (value > score) { score = value; best = i }
  })
  return best
}
