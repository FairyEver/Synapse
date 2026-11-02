import type { HandState } from "./hand-runner"
import { betToMatch } from "./betting"
import { after } from "./seat-order"

export type HandTransition = { kind: "none" } | { kind: "turn"; seatNo: number } | { kind: "street"; street: "flop" | "turn" | "river"; count: number } | { kind: "settle"; showdown: boolean }
export function nextHandTransition(h: HandState, afterSeat: number): HandTransition {
  if (h.street === "settled") return { kind: "none" }
  const live = h.seats.filter(s => !s.folded)
  if (live.length === 1) return { kind: "settle", showdown: false }
  const active = live.filter(s => !s.allIn), pending = active.filter(s => s.lastActedBet === null || s.streetBet < h.currentBet)
  if (active.length > 1 && pending.length || active.length === 1 && active[0].streetBet < betToMatch(h, active[0].seatNo)) {
    const seatNo = after(h.seats.map(s => s.seatNo), afterSeat).find(no => pending.some(s => s.seatNo === no))
    if (seatNo === undefined) throw new Error("POKER_HAND_TURN_INVALID")
    return { kind: "turn", seatNo }
  }
  if (h.street === "river") return { kind: "settle", showdown: true }
  return { kind: "street", street: h.street === "preflop" ? "flop" : h.street === "flop" ? "turn" : "river", count: h.street === "preflop" ? 3 : 1 }
}
