import type { Pot } from "../pots"
import type { GameReserveLot, GameReserveClaim, GameReserveMovement } from "@synapse/shared/game-contracts"

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

export interface ReservePerson { admissionId: string; userId: string; seatNo: number }
export type ReserveLot = GameReserveLot
export type ReserveClaim = GameReserveClaim
export type ReserveMovement = GameReserveMovement
export interface ReserveState { revision: number; lots: ReserveLot[]; claims: ReserveClaim[]; movements: ReserveMovement[]; finalized: boolean }
export type ReserveOperation =
  | { kind: "deposit"; payer: ReservePerson; recipients: readonly ReservePerson[]; amount: number; sourceId: string; sourceType: string }
  | { kind: "steal"; actorAdmissionId: string; cap: number; target: "all" | "richest"; targetAdmissionId?: string; protectedAdmissions?: readonly string[] }
  | { kind: "refund"; actorAdmissionId: string; lotId: string; cap?: number }
  | { kind: "finalize" }
export interface ReserveResult { state: ReserveState; amount: number; credits: Record<string, number>; debits: Record<string, number>; protectedAdmissions: string[] }
