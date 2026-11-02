import type { ResolutionContext } from "../cards/types"
import type { ReserveState, ReserveOperation, ReserveResult, ReserveClaim } from "./types"

function natural(n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("POKER_RESERVE_INVALID")
}
/** Caller supplies stable tie order. BigInt prevents multiplication from losing chips. */
export function proportional(amount: number, weights: readonly number[]): number[] {
  natural(amount); weights.forEach(natural)
  const total = weights.reduce((n, w) => n + BigInt(w), 0n)
  if (!total) return weights.map(() => 0)
  if (BigInt(amount) > total) throw new Error("POKER_RESERVE_INVALID")
  const values = weights.map((w, i) => ({ i, value: Number(BigInt(amount) * BigInt(w) / total), remainder: BigInt(amount) * BigInt(w) % total }))
  let left = amount - values.reduce((n, v) => n + v.value, 0)
  for (const value of [...values].sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)) {
    if (!left) break
    value.value++; left--
  }
  return values.map(v => v.value)
}

export function assertReserveIntegrity(state: ReserveState): void {
  for (const list of [state.lots, state.claims, state.movements]) {
    if (new Set(list.map(x => x.id)).size !== list.length) throw new Error("POKER_RESERVE_INVALID")
  }
  for (const lot of state.lots) {
    natural(lot.originalAmount); natural(lot.remainingAmount)
    const claims = state.claims.filter(c => c.lotId === lot.id)
    if (claims.reduce((n, c) => n + c.originalAmount, 0) !== lot.originalAmount || claims.reduce((n, c) => n + c.remainingAmount, 0) !== lot.remainingAmount
      || state.movements.filter(m => m.lotId === lot.id && m.kind !== "deposit").reduce((n, m) => n + m.amount, 0) + lot.remainingAmount !== lot.originalAmount)
      throw new Error("POKER_RESERVE_INVALID")
  }
  for (const claim of state.claims) {
    natural(claim.originalAmount); natural(claim.remainingAmount)
    if (claim.remainingAmount > claim.originalAmount || !state.lots.some(l => l.id === claim.lotId)) throw new Error("POKER_RESERVE_INVALID")
  }
  for (const m of state.movements) {
    natural(m.amount)
    if (!state.lots.some(l => l.id === m.lotId) || m.claimId && !state.claims.some(c => c.id === m.claimId && c.lotId === m.lotId)) throw new Error("POKER_RESERVE_INVALID")
  }
}

export function lastReserveDeposit(state: ReserveState, payerAdmissionId: string, beforeSeq: number) {
  return state.lots.filter(l => l.payerAdmissionId === payerAdmissionId && l.originalAmount > 0 && l.sourceSeq < beforeSeq)
    .sort((a, b) => b.sourceSeq - a.sourceSeq || state.lots.indexOf(b) - state.lots.indexOf(a))[0]
}

export function applyReserveOperation(original: ReserveState, operation: ReserveOperation, context: ResolutionContext, order: readonly number[]): ReserveResult {
  assertReserveIntegrity(original)
  const state = structuredClone(original), result: ReserveResult = { state, amount: 0, credits: {}, debits: {}, protectedAdmissions: [] }
  if (state.finalized) {
    if (operation.kind === "finalize") return result
    throw new Error("POKER_RESERVE_FINALIZED")
  }
  const ordered = (claims: ReserveClaim[]) => claims.sort((a, b) => order.indexOf(a.seatNo) - order.indexOf(b.seatNo)
    || state.lots.find(l => l.id === a.lotId)!.sourceSeq - state.lots.find(l => l.id === b.lotId)!.sourceSeq || state.claims.indexOf(a) - state.claims.indexOf(b))
  const movement = (kind: "steal" | "refund" | "finalize", claim: ReserveClaim, amount: number, recipient: string, actor?: string) => {
    if (!amount) return
    claim.remainingAmount -= amount
    state.lots.find(l => l.id === claim.lotId)!.remainingAmount -= amount
    state.movements.push({ id: context.nextId(), rootActionId: context.rootActionId, eventIndex: state.movements.length, kind, amount, lotId: claim.lotId, claimId: claim.id, toAdmissionId: recipient, actorAdmissionId: actor })
    result.credits[recipient] = (result.credits[recipient] ?? 0) + amount
    result.amount += amount
  }
  if (operation.kind === "deposit") {
    natural(operation.amount)
    const recipients = [...operation.recipients].sort((a, b) => order.indexOf(a.seatNo) - order.indexOf(b.seatNo))
    if (recipients.some(p => p.admissionId === operation.payer.admissionId || !order.includes(p.seatNo)) || new Set(recipients.map(p => p.admissionId)).size !== recipients.length) throw new Error("POKER_RESERVE_INVALID")
    const prior = state.lots.find(l => l.sourceId === operation.sourceId)
    if (prior) {
      const oldClaims = ordered(state.claims.filter(c => c.lotId === prior.id))
      if (prior.originalAmount !== operation.amount || prior.sourceType !== operation.sourceType || prior.payerAdmissionId !== operation.payer.admissionId
        || JSON.stringify(oldClaims.map(c => [c.admissionId, c.userId, c.seatNo])) !== JSON.stringify(recipients.map(p => [p.admissionId, p.userId, p.seatNo]))) throw new Error("POKER_RESERVE_SOURCE_CONFLICT")
      return result
    }
    if (!operation.amount) return result
    if (!recipients.length) throw new Error("POKER_RESERVE_NO_RECIPIENT")
    const lot = { id: context.nextId(), sourceId: operation.sourceId, sourceType: operation.sourceType, sourceSeq: context.actionSeq,
      payerAdmissionId: operation.payer.admissionId, payerUserId: operation.payer.userId, payerSeatNo: operation.payer.seatNo, originalAmount: operation.amount, remainingAmount: operation.amount }
    state.lots.push(lot)
    recipients.forEach((p, i) => {
      const amount = Math.floor(operation.amount / recipients.length) + (i < operation.amount % recipients.length ? 1 : 0)
      state.claims.push({ admissionId: p.admissionId, userId: p.userId, seatNo: p.seatNo, id: context.nextId(), lotId: lot.id, originalAmount: amount, remainingAmount: amount, status: "pending" })
    })
    state.movements.push({ id: context.nextId(), rootActionId: context.rootActionId, eventIndex: state.movements.length, kind: "deposit", amount: operation.amount, lotId: lot.id, actorAdmissionId: operation.payer.admissionId })
    result.debits[operation.payer.admissionId] = operation.amount; result.amount = operation.amount
  } else if (operation.kind === "steal") {
    natural(operation.cap)
    const claims = ordered(state.claims.filter(c => c.admissionId !== operation.actorAdmissionId && c.remainingAmount > 0))
    const people = [...new Set(claims.map(c => c.admissionId))].map(id => ({ id, claims: claims.filter(c => c.admissionId === id), total: claims.filter(c => c.admissionId === id).reduce((n, c) => n + c.remainingAmount, 0) }))
    const targets = operation.targetAdmissionId ? people.filter(p => p.id === operation.targetAdmissionId) : operation.target === "richest" ? [...people].sort((a, b) => b.total - a.total).slice(0, 1) : people
    const total = targets.reduce((n, p) => n + p.total, 0)
    if (!total || !operation.cap) throw new Error("POKER_RESERVE_EMPTY")
    const planned = proportional(Math.min(operation.cap, total), targets.map(p => p.total))
    result.protectedAdmissions = targets.filter((p, i) => planned[i] > 0 && operation.protectedAdmissions?.includes(p.id)).map(p => p.id)
    const unprotected = targets.filter(p => !operation.protectedAdmissions?.includes(p.id))
    const losses = proportional(Math.min(operation.cap, unprotected.reduce((n, p) => n + p.total, 0)), unprotected.map(p => p.total))
    unprotected.forEach((p, i) => {
      const shares = proportional(losses[i], p.claims.map(c => c.remainingAmount))
      p.claims.forEach((c, j) => movement("steal", c, shares[j], operation.actorAdmissionId, operation.actorAdmissionId))
    })
  } else if (operation.kind === "refund") {
    const lot = state.lots.find(l => l.id === operation.lotId && l.payerAdmissionId === operation.actorAdmissionId && l.sourceSeq < context.actionSeq)
    if (!lot) throw new Error("POKER_RESERVE_INVALID_TARGET")
    if (!lot.remainingAmount) throw new Error("POKER_RESERVE_EMPTY")
    const cap = operation.cap ?? lot.remainingAmount; natural(cap)
    const claims = ordered(state.claims.filter(c => c.lotId === lot.id)), shares = proportional(Math.min(cap, lot.remainingAmount), claims.map(c => c.remainingAmount))
    claims.forEach((c, i) => movement("refund", c, shares[i], operation.actorAdmissionId, operation.actorAdmissionId))
  } else {
    for (const claim of ordered([...state.claims])) {
      movement("finalize", claim, claim.remainingAmount, claim.admissionId)
      claim.status = "finalized"
    }
    state.finalized = true
  }
  state.revision++
  assertReserveIntegrity(state)
  return result
}
