export interface Pot {
  amount: number
  eligible: number[]
  refund: boolean
  winners?: number[]
  shares?: Record<number, number>
}
export function splitPots(
  seats: readonly { seatNo: number; total: number; folded: boolean }[],
): Pot[] {
  const levels = [...new Set(seats.map((s) => s.total).filter((n) => n > 0))].sort((a, b) => a - b)
  let previous = 0
  return levels.map((level) => {
    const contributors = seats.filter((s) => s.total >= level)
    const amount = (level - previous) * contributors.length
    previous = level
    return {
      amount,
      eligible: contributors
        .filter((s) => contributors.length === 1 || !s.folded)
        .map((s) => s.seatNo),
      refund: contributors.length === 1,
    }
  })
}
export function distribute(
  amount: number,
  winners: readonly number[],
  order: readonly number[],
): Record<number, number> {
  if (!Number.isSafeInteger(amount) || amount < 0 || !winners.length)
    throw new Error("底池无法结算")
  const sorted = order.filter((s) => winners.includes(s))
  if (sorted.length !== winners.length) throw new Error("赢家位置无效")
  return Object.fromEntries(
    sorted.map((s, i) => [
      s,
      Math.floor(amount / winners.length) + (i < amount % winners.length ? 1 : 0),
    ]),
  )
}
