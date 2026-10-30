export function after(seats: readonly number[], dealer: number): number[] {
  const sorted = [...seats].sort((a, b) => a - b)
  return [...sorted.filter((s) => s > dealer), ...sorted.filter((s) => s <= dealer)]
}
export function seatOrder(seats: readonly number[], dealer: number) {
  if (
    seats.length < 2 ||
    seats.length > 10 ||
    new Set(seats).size !== seats.length ||
    !seats.includes(dealer)
  )
    throw new Error("无效座位")
  const postflop = after(seats, dealer)
  const smallBlind = seats.length === 2 ? dealer : postflop[0]
  const bigBlind = seats.length === 2 ? postflop[0] : postflop[1]
  return { smallBlind, bigBlind, preflop: after(seats, bigBlind), postflop }
}
