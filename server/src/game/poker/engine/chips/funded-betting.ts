import { applyBet, legalActions, type BettingState, type Decision } from "../betting"
import type { ChipPaymentQuote } from "./types"

export function legalFundedActions(h: BettingState, seatNo: number, capacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("POKER_INVALID_PAYMENT")
  const preview = structuredClone(h), seat = preview.seats.find(s => s.seatNo === seatNo)
  if (seat) {
    seat.stack += capacity
    if (!Number.isSafeInteger(seat.stack)) throw new Error("POKER_INVALID_PAYMENT")
  }
  return legalActions(preview, seatNo)
}

/** Existing betting rules operate on nominal capacity; only the quoted real payment leaves the stack. */
export function applyFundedBet<T extends BettingState>(state: T, seatNo: number, decision: Decision, quote: ChipPaymentQuote): T {
  const source = state.seats.find(s => s.seatNo === seatNo)
  if (!source || !quote.satisfied || ![quote.nominalAmount, quote.waivedAmount, quote.paidAmount].every(n => Number.isSafeInteger(n) && n >= 0)
    || quote.nominalAmount !== quote.waivedAmount + quote.paidAmount || quote.paidAmount > source.stack)
    throw new Error("POKER_PAYMENT_MISMATCH")
  const virtual = structuredClone(state)
  virtual.seats.find(s => s.seatNo === seatNo)!.stack += quote.waivedAmount
  const next = applyBet(virtual, seatNo, decision), seat = next.seats.find(s => s.seatNo === seatNo)!
  const nominal = seat.streetBet - source.streetBet
  if (nominal !== quote.nominalAmount) throw new Error("POKER_PAYMENT_MISMATCH")
  seat.stack = source.stack - quote.paidAmount
  seat.total = source.total + quote.paidAmount
  seat.nominalTotal = (source.nominalTotal ?? source.total) + nominal
  seat.allIn = source.allIn || seat.stack === 0
  return next
}
