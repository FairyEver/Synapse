import { applyBet, legalActions, type BettingState, type Decision } from "../betting"
import type { ChipPaymentQuote } from "./types"
import type { HandState } from "../hand-runner"
import { createHash } from "node:crypto"
import { paymentModifiers } from "../cards/statuses"
import { quoteChipPayment } from "./payment"

export function fundedBetCapacity(h: HandState, seatNo: number): number {
  const seat = h.seats.find(s => s.seatNo === seatNo)
  if (!seat) throw new Error("POKER_INVALID_PAYMENT")
  return quoteChipPayment({ payerId: String(seatNo), resource: "chips", purpose: "bet", balance: seat.stack, nominalAmount: 0, revision: "capacity" }, paymentModifiers(h, seatNo)).maximumNominalAmount - seat.stack
}
export function betPaymentVersion(h: HandState, seatNo: number, handId: string, actionSeq: number, controlVersion: number): string {
  return createHash("sha256").update(JSON.stringify([handId, actionSeq, controlVersion, seatNo, h.street, h.currentBet, h.minRaise, h.seats.map(s => [s.seatNo, s.stack, s.streetBet, s.folded, s.allIn]), paymentModifiers(h, seatNo)])).digest("hex").slice(0, 32)
}
export function quoteFundedBet(h: HandState, seatNo: number, decision: Decision): ChipPaymentQuote {
  const seat = h.seats.find(s => s.seatNo === seatNo)!, legal = legalFundedActions(h, seatNo, fundedBetCapacity(h, seatNo))
  const nominalAmount = decision.action === "call" ? Math.min(legal.toCall, legal.maxRaiseTo - seat.streetBet) : decision.action === "allin" ? legal.maxRaiseTo - seat.streetBet : decision.action === "bet" || decision.action === "raise" ? (decision.to ?? -1) - seat.streetBet : 0
  return quoteChipPayment({ payerId: String(seatNo), resource: "chips", purpose: "bet", balance: seat.stack, nominalAmount, revision: "bet" }, paymentModifiers(h, seatNo))
}

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
