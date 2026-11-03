import type { HandState } from "../hand-runner"
import { CardRuleError } from "./types"

// Basis points for blind/pot rates; whole percentages for the street and repeat factors.
export const CARD_PRICING_V3 = {
  cards: {
    "01": { kind: "replacement", blindBps: 2500, potBps: 350 },
    "02": { kind: "replacement", blindBps: 2500, potBps: 450 },
    "06": { kind: "replacement", blindBps: 7500, potBps: 1200 },
    "07": { kind: "replacement", blindBps: 7500, potBps: 1200 },
    "11": { kind: "intel", blindBps: 2500, potBps: 150 },
    "14": { kind: "intel", blindBps: 5000, potBps: 400 },
    "22": { kind: "pool", blindBpsPerDraw: 2500, maxDraws: 2 },
    "48": { kind: "free" },
  },
  streetPotPercent: { preflop: 50, flop: 100, turn: 125, river: 150, settled: 150 },
  repeatStepPercent: 35,
  maxPreviousUses: 3,
} as const

const policy = (id: string) => CARD_PRICING_V3.cards[id as keyof typeof CARD_PRICING_V3.cards]

export function cardBasePriceV3(h: HandState, cardId: string, seatNo: number): number {
  const pricing = policy(cardId), actor = h.seats.find(s => s.seatNo === seatNo)
  if (!pricing || !actor || !h.cards) throw new CardRuleError("POKER_CARD_STATE_INVALID")
  if (pricing.kind === "free") return 0
  let numerator: bigint
  const blind = BigInt(h.bigBlind)
  if (pricing.kind === "pool") {
    const drawn = Math.min(h.cards.pool.length, pricing.maxDraws)
    numerator = blind * BigInt(drawn * pricing.blindBpsPerDraw) * 10000n
  } else {
    // Count already funded ordinary stakes that the actor can match. Fees never feed their own price.
    const cap = BigInt(actor.total) + BigInt(actor.stack)
    const pot = h.seats.reduce((sum, seat) => sum + (BigInt(seat.total) < cap ? BigInt(seat.total) : cap), 0n)
    const previous = pricing.kind === "replacement" ? h.cards.used.filter(use =>
      use.seatNo === seatNo && use.status !== "blocked" && policy(use.cardId)?.kind === "replacement").length : 0
    const repeat = 100 + CARD_PRICING_V3.repeatStepPercent * Math.min(previous, CARD_PRICING_V3.maxPreviousUses)
    const street = pricing.kind === "replacement" ? CARD_PRICING_V3.streetPotPercent[h.street] : 100
    numerator = (blind * BigInt(pricing.blindBps) * 100n + pot * BigInt(pricing.potBps * street)) * BigInt(repeat)
  }
  const denominator = 100_000_000n
  const price = (numerator + denominator - 1n) / denominator
  if (price > BigInt(Number.MAX_SAFE_INTEGER)) throw new CardRuleError("POKER_INVALID_PAYMENT")
  return Number(price)
}
