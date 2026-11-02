import { orderedDeck, shuffle } from "./deck"
import type { HandState } from "./hand-runner"
import { distribute } from "./pots"
import { after } from "./seat-order"
import { ROLL_PRICING_VERSION } from "./rules"
export { ROLL_PRICING_VERSION } from "./rules"
export type RollKind = "normal" | "super"
export interface RollHistory {
  id: string
  seatNo: number
  kind: RollKind
  cardIndex: number
  oldCard: string
  candidates: string[]
  selectedIndex: number | null
  fee: number
  street: "preflop" | "flop" | "turn"
  count: number
  compensations: Record<number, number>
}
export interface RollState {
  /** Missing only on hands started before the coin limit was introduced. */
  coinPolicy?: { limit: number; normal: number; super: number }
  counts: Record<number, number>
  paid: Record<number, number>
  credits: Record<number, number>
  released: boolean
  originalHoles: Record<number, string[]>
  history: RollHistory[]
  pending: RollHistory | null
}
export interface RollOffer { fee: number; available: boolean; reason?: string; coinCost?: number }
export interface RollQuote { enabled: boolean; pricingVersion?: string; count: number; coins?: { balance: number; limit: number }; normal: RollOffer; super: RollOffer }
function rollCoins(roll: RollState | undefined, seatNo: number) {
  const policy = roll?.coinPolicy
  if (policy === undefined) return undefined
  if (!policy || [policy.limit, policy.normal, policy.super].some(n => !Number.isSafeInteger(n) || n <= 0) || policy.normal !== 1 || policy.super !== 3)
    throw new Error("POKER_ROLL_STATE_INVALID")
  const used = roll!.history.filter(r => r.seatNo === seatNo).reduce((sum, r) => {
    if (r.kind !== "normal" && r.kind !== "super") throw new Error("POKER_ROLL_STATE_INVALID")
    return sum + policy[r.kind]
  }, 0)
  if (!Number.isSafeInteger(used) || used > policy.limit) throw new Error("POKER_ROLL_STATE_INVALID")
  return { balance: policy.limit - used, limit: policy.limit }
}
export function rollFinancials(state: HandState, seatNo: number): { effectivePot: number; effectiveFuture: number } {
  const p = state.seats.find(s => s.seatNo === seatNo)
  if (!p) throw new Error("POKER_ROLL_SEAT_INVALID")
  const cap = BigInt(p.total) + BigInt(p.stack)
  const min = (a: bigint, b: bigint) => a < b ? a : b
  const P = state.seats.reduce((sum, s) => sum + min(BigInt(s.total), cap), 0n)
  const E = state.seats.filter(s => s.seatNo !== seatNo && !s.folded).reduce((sum, s) => {
    const remaining = min(BigInt(s.stack), cap - BigInt(s.total))
    return sum + (remaining > 0n ? remaining : 0n)
  }, 0n)
  if (P > BigInt(Number.MAX_SAFE_INTEGER) || E > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("POKER_ROLL_MONEY_INVALID")
  return { effectivePot: Number(P), effectiveFuture: Number(E) }
}
export function quoteRoll(state: HandState, seatNo: number): RollQuote {
  const count = state.roll?.counts[seatNo] ?? 0
  if (!state.ruleOptions?.roll) return { enabled: false, count, normal: { fee: 0, available: false, reason: "POKER_ROLL_DISABLED" }, super: { fee: 0, available: false, reason: "POKER_ROLL_DISABLED" } }
  if (state.rollPricingVersion !== ROLL_PRICING_VERSION) throw new Error("POKER_ROLL_VERSION_UNSUPPORTED")
  const p = state.seats.find(s => s.seatNo === seatNo)
  const coins = p ? rollCoins(state.roll, seatNo) : undefined
  const { effectivePot: P, effectiveFuture: E } = p ? rollFinancials(state, seatNo) : { effectivePot: 0, effectiveFuture: 0 }
  const [u, v] = state.street === "preflop" ? [1n, 3n] : state.street === "flop" ? [2n, 5n] : [4n, 8n]
  const T = 10n * BigInt(P) + BigInt(E), N = u * T > 2000n ? u * T : 2000n
  const S = v * T > N + 2000n ? v * T : N + 2000n
  const offer = (base: bigint, kind: RollKind): RollOffer => {
    const exact = ((1n + BigInt(count)) * base + 1999n) / 2000n
    if (exact > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("POKER_ROLL_MONEY_INVALID")
    const fee = Number(exact)
    const coinCost = state.roll?.coinPolicy?.[kind]
    const reason = !state.roll ? "POKER_ROLL_STATE_INVALID" : state.roll.pending && state.roll.pending.seatNo !== seatNo ? "POKER_ROLL_CHOICE_REQUIRED" : !["preflop", "flop", "turn"].includes(state.street) ? "POKER_ROLL_STREET_INVALID" : !p || p.folded || p.allIn || state.actionOnSeat !== seatNo || !state.seats.some(s => s.seatNo !== seatNo && !s.folded) ? "POKER_ROLL_NOT_YOUR_TURN" : coins && coinCost !== undefined && coins.balance < coinCost ? "POKER_ROLL_INSUFFICIENT_COINS" : exact >= BigInt(p.stack) ? "POKER_ROLL_INSUFFICIENT_STACK" : undefined
    return { fee, available: !reason, ...(coinCost !== undefined ? { coinCost } : {}), ...(reason ? { reason } : {}) }
  }
  return { enabled: true, pricingVersion: ROLL_PRICING_VERSION, count, ...(coins ? { coins } : {}), normal: offer(N, "normal"), super: offer(S, "super") }
}
export function startRoll(state: HandState, seatNo: number, input: { rollId: string; kind: RollKind; cardIndex: number; fee: number }, randomInt: (exclusiveMax: number) => number): HandState {
  const quote = quoteRoll(state, seatNo)
  if (["normal", "super"].includes(input.kind) && quote[input.kind].reason === "POKER_ROLL_INSUFFICIENT_COINS") throw new Error("POKER_ROLL_INSUFFICIENT_COINS")
  if (!quote.enabled || !["normal", "super"].includes(input.kind) || !quote[input.kind].available || input.fee !== quote[input.kind].fee || ![0, 1].includes(input.cardIndex) || !input.rollId || state.roll!.history.some(r => r.id === input.rollId)) throw new Error("POKER_ROLL_ILLEGAL_ACTION")
  if (state.roll?.pending && state.roll.pending.cardIndex !== input.cardIndex) throw new Error("POKER_ROLL_ILLEGAL_ACTION")
  assertHandIntegrity(state)
  const h = structuredClone(state), roll = h.roll!, p = h.seats.find(s => s.seatNo === seatNo)!
  if (roll.pending) {
    // Paid candidates are forfeited only with a successful new start; the slot stays committed.
    h.deck = shuffle([...h.deck, ...roll.pending.candidates], randomInt)
    roll.pending = null
  }
  const amount = input.kind === "super" ? 3 : 1
  if (h.deck.length < amount) throw new Error("POKER_ROLL_DECK_EXHAUSTED")
  const candidates: string[] = []
  for (let i = 0; i < amount; i++) {
    const index = randomInt(h.deck.length)
    if (!Number.isInteger(index) || index < 0 || index >= h.deck.length) throw new Error("无效抽牌熵")
    candidates.push(h.deck.splice(index, 1)[0])
  }
  const compensations = distribute(input.fee, h.seats.filter(s => s.seatNo !== seatNo && !s.folded).map(s => s.seatNo), after(h.seats.map(s => s.seatNo), h.dealerSeat))
  p.stack -= input.fee
  roll.counts[seatNo] = (roll.counts[seatNo] ?? 0) + 1
  roll.paid[seatNo] = (roll.paid[seatNo] ?? 0) + input.fee
  for (const [no, fee] of Object.entries(compensations)) roll.credits[Number(no)] = (roll.credits[Number(no)] ?? 0) + fee
  const entry: RollHistory = { id: input.rollId, seatNo, kind: input.kind, cardIndex: input.cardIndex, oldCard: p.hole[input.cardIndex], candidates, selectedIndex: null, fee: input.fee, street: h.street as RollHistory["street"], count: roll.counts[seatNo], compensations }
  roll.history.push(entry)
  roll.pending = entry
  if (input.kind === "normal") return chooseRollCard(h, seatNo, entry.id, 0, randomInt)
  assertHandIntegrity(h)
  return h
}
export function chooseRollCard(state: HandState, seatNo: number, rollId: string, candidateIndex: number, randomInt: (exclusiveMax: number) => number): HandState {
  const pending = state.roll?.pending
  if (!pending || pending.seatNo !== seatNo || pending.id !== rollId || !Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= pending.candidates.length) throw new Error("POKER_ROLL_CHOICE_INVALID")
  assertHandIntegrity(state)
  const h = structuredClone(state), entry = h.roll!.history.find(r => r.id === rollId)!, p = h.seats.find(s => s.seatNo === seatNo)!
  p.hole[entry.cardIndex] = entry.candidates[candidateIndex]
  h.deck = shuffle([...h.deck, entry.oldCard, ...entry.candidates.filter((_, i) => i !== candidateIndex)], randomInt)
  entry.selectedIndex = candidateIndex
  h.roll!.pending = null
  assertHandIntegrity(h)
  return h
}
/** Checks physical cards, and original-capital conservation (credits stay frozen until settlement). */
export function assertHandIntegrity(h: HandState): void {
  const integers = h.seats.flatMap(s => [s.stack, s.total, s.startingStack, s.streetBet])
  if (integers.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error("POKER_HAND_MONEY_INVALID")
  const original = h.seats.reduce((sum, s) => sum + BigInt(s.startingStack), 0n)
  const frozen = h.roll && !h.roll.released ? Object.values(h.roll.credits).reduce((sum, n) => {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("POKER_HAND_MONEY_INVALID")
    return sum + BigInt(n)
  }, 0n) : 0n
  const funds = h.seats.reduce((sum, s) => sum + BigInt(s.stack) + (h.street === "settled" ? 0n : BigInt(s.total)), frozen)
  if (funds !== original) throw new Error("筹码不守恒")
  if (h.ruleOptions?.roll && (!h.roll || !h.burnedCards || h.rollPricingVersion !== ROLL_PRICING_VERSION)) throw new Error("POKER_ROLL_STATE_INVALID")
  if (h.roll?.coinPolicy !== undefined) for (const seat of h.seats) rollCoins(h.roll, seat.seatNo)
  const cards = [...h.deck, ...h.board, ...h.seats.flatMap(s => s.hole), ...(h.burnedCards ?? []), ...(h.roll?.pending?.candidates ?? [])]
  const deck = orderedDeck(h.variant)
  if (new Set(cards).size !== cards.length || cards.some(c => !deck.includes(c)) || ((h.burnedCards || h.ruleOptions?.roll) && cards.length !== deck.length)) throw new Error("POKER_HAND_CARDS_INVALID")
}
