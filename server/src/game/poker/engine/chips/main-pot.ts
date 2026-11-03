import type { HandState } from "../hand-runner"

export function mainPotFeeAmount(h: HandState): number {
  return Object.values(h.mainPotFees ?? {}).reduce((sum, amount) => sum + amount, 0)
}

export function handPotAmount(h: HandState): number {
  return h.seats.reduce((sum, seat) => sum + seat.total, mainPotFeeAmount(h))
}
