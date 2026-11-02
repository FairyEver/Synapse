import type { FundedPot, FundedSeat } from "./types"

/** Allocate each player's real contribution across nominal layers using exact largest remainders. */
export function splitFundedPots(seats: readonly FundedSeat[], order: readonly number[]): FundedPot[] {
  if (new Set(seats.map(s => s.seatNo)).size !== seats.length || seats.some(s => !order.includes(s.seatNo)
    || !Number.isSafeInteger(s.nominalTotal) || !Number.isSafeInteger(s.paidTotal) || s.paidTotal < 0 || s.nominalTotal < s.paidTotal))
    throw new Error("POKER_INVALID_CONTRIBUTION")
  const levels = [...new Set(seats.map(s => s.nominalTotal).filter(n => n > 0))].sort((a, b) => a - b)
  const amounts = levels.map(() => 0)
  for (const seat of seats) {
    if (!seat.nominalTotal) continue
    const denominator = BigInt(seat.nominalTotal)
    const shares = levels.map((level, i) => {
      const height = Math.max(0, Math.min(level, seat.nominalTotal) - (levels[i - 1] ?? 0))
      const numerator = BigInt(height) * BigInt(seat.paidTotal)
      return { i, amount: Number(numerator / denominator), remainder: numerator % denominator }
    })
    let left = seat.paidTotal - shares.reduce((n, s) => n + s.amount, 0)
    for (const s of [...shares].sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)) {
      if (!left) break
      s.amount++; left--
    }
    for (const share of shares) amounts[share.i] += share.amount
  }
  return levels.map((level, i) => {
    const contributors = seats.filter(s => s.nominalTotal >= level)
    return { amount: amounts[i], eligible: contributors.filter(s => contributors.length === 1 || !s.folded).map(s => s.seatNo), refund: contributors.length === 1 }
  }).filter(p => p.amount > 0)
}
