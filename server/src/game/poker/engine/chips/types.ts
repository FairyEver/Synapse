import type { Pot } from "../pots"

export interface ChipPaymentInput {
  payerId: string; resource: "chips" | "diamonds"; purpose: "bet" | "blind" | "roll" | "card"
  nominalAmount: number; balance: number; revision: string
  components?: readonly { source: string; amount: number }[]
}
export interface ChipPaymentModifier { id: string; kind: "waiver"; cap: number }
export interface ChipPaymentQuote {
  nominalAmount: number; waivedAmount: number; paidAmount: number
  consumedModifierIds: string[]; version: string; satisfied: boolean; maximumNominalAmount: number
}
export interface FundedSeat { seatNo: number; nominalTotal: number; paidTotal: number; folded: boolean }
export type FundedPot = Pot
