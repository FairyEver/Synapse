import { createHash } from "node:crypto"
import type { PokerReserveView } from "@synapse/shared/game-contracts"
import type { ReserveState } from "./engine/chips/types"
import { assertReserveIntegrity } from "./engine/chips/reserve"

export interface ReserveProjectionInput {
  roomId: string; handId: string; status: string; userId: string; state?: ReserveState | null
  participants: readonly { admissionId: string | null; userId: string; seatNo: number; displayName: string }[]
}
export function projectReserveView(input: ReserveProjectionInput): PokerReserveView | undefined {
  const { state, participants } = input
  if (!state || participants.length > 10 || participants.some(p => !p.admissionId) || new Set(participants.map(p => p.admissionId)).size !== participants.length) return undefined
  try { assertReserveIntegrity(state) } catch {
    // A corrupt optional source is unavailable, never a fabricated zero balance.
    return undefined
  }
  const identities = new Map(participants.map(p => [p.admissionId!, { ...p, key: createHash("sha256").update(JSON.stringify([input.roomId, input.handId, p.admissionId])).digest("hex") }]))
  if (state.lots.some(l => { const p = identities.get(l.payerAdmissionId); return !p || p.userId !== l.payerUserId || p.seatNo !== l.payerSeatNo })
    || state.claims.some(c => { const p = identities.get(c.admissionId); return !p || p.userId !== c.userId || p.seatNo !== c.seatNo })
    || state.movements.some(m => m.actorAdmissionId && !identities.has(m.actorAdmissionId) || m.toAdmissionId && !identities.has(m.toAdmissionId))) return undefined
  const total = state.lots.reduce((n, l) => n + l.remainingAmount, 0)
  if (!Number.isSafeInteger(total)) return undefined
  return { handId: input.handId, status: input.status === "cancelled" ? "cancelled" : state.finalized || input.status === "settled" ? "released" : "pending", total, complete: state.lots.length <= 1000 && state.movements.length <= 1000,
    players: [...identities.values()].map(p => ({ key: p.key, seatNo: p.seatNo, displayName: p.displayName, isMe: p.userId === input.userId, pending: state.claims.filter(c => c.admissionId === p.admissionId).reduce((n, c) => n + c.remainingAmount, 0) })),
    lots: state.lots.slice(0, 1000).map(l => ({ id: l.id, payerKey: identities.get(l.payerAdmissionId)!.key, sourceType: l.sourceType, originalAmount: l.originalAmount, remainingAmount: l.remainingAmount,
      shares: state.claims.filter(c => c.lotId === l.id).map(c => ({ key: identities.get(c.admissionId)!.key, originalAmount: c.originalAmount, remainingAmount: c.remainingAmount })) })),
    movements: state.movements.slice(0, 1000).map(m => ({ id: m.id, seq: m.eventIndex, kind: m.kind, amount: m.amount, lotId: m.lotId,
      ...(m.claimId && state.claims.some(c => c.id === m.claimId) ? { beneficiaryKey: identities.get(state.claims.find(c => c.id === m.claimId)!.admissionId)!.key } : {}),
      ...(m.actorAdmissionId ? { actorKey: identities.get(m.actorAdmissionId)!.key } : {}), ...(m.toAdmissionId ? { recipientKey: identities.get(m.toAdmissionId)!.key } : {}) })),
  }
}
