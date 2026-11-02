import type { GameFunding } from "./game.js"

export interface GameReserveScope { gameKind: string; gameRoomId: string; settlementId: string; funding: GameFunding }
export interface GameReserveClaim {
  id: string; lotId: string; admissionId: string; userId: string; seatNo: number
  originalAmount: number; remainingAmount: number; status: "pending" | "finalized"
}
export interface GameReserveLot {
  id: string; sourceId: string; sourceType: string; sourceSeq: number
  payerAdmissionId: string; payerUserId: string; payerSeatNo: number
  originalAmount: number; remainingAmount: number
}
export interface GameReserveMovement {
  id: string; rootActionId: string; eventIndex: number
  kind: "deposit" | "steal" | "refund" | "finalize"
  amount: number; lotId: string; claimId?: string; toAdmissionId?: string; actorAdmissionId?: string
}
export interface GameReserveWriteBatch {
  scope: GameReserveScope; expectedRevision: number
  lots: readonly GameReserveLot[]; claims: readonly GameReserveClaim[]; movements: readonly GameReserveMovement[]
}
export interface PokerReserveView {
  handId: string; status: "pending" | "released" | "cancelled"; total: number; complete: boolean
  players: { key: string; seatNo: number; displayName: string; isMe: boolean; pending: number }[]
  lots: { id: string; payerKey: string; sourceType: string; originalAmount: number; remainingAmount: number; shares: { key: string; originalAmount: number; remainingAmount: number }[] }[]
  movements: { id: string; seq: number; kind: GameReserveMovement["kind"]; amount: number; lotId: string; actorKey?: string; recipientKey?: string }[]
}
