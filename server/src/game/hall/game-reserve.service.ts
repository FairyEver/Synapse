import { createHash } from "node:crypto"
import { Injectable, BadRequestException } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { GameReserveScope, GameReserveWriteBatch } from "@synapse/shared/game-contracts"
import type { PendingTransferInput } from "./hall.service"

const fail = (): never => { throw new BadRequestException("暂存版本或分录意图不一致。") }
const int = (n: number) => Number.isInteger(n) && n >= 0 && n <= 2147483647
function same(a: object, b: object, keys = Object.keys(b)): boolean {
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  return keys.every(key => (left[key] ?? null) === (right[key] ?? null))
}
async function collect<T extends { id: string }>(page: (after?: string) => Promise<T[]>): Promise<T[]> {
  const result: T[] = []; let cursor: string | undefined
  for (;;) {
    const rows = await page(cursor); result.push(...rows)
    if (rows.length < 1000) return result
    cursor = rows.at(-1)!.id
  }
}
@Injectable()
export class GameReserveService {
  private async lock(tx: Prisma.TransactionClient, scope: GameReserveScope): Promise<void> {
    const key = JSON.stringify([scope.gameKind, scope.gameRoomId, scope.settlementId, scope.funding])
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS "lock"`
  }
  /** Caller holds its game and ordered account locks; this service only persists validated funds. */
  async apply(tx: Prisma.TransactionClient, input: GameReserveWriteBatch): Promise<void> {
    const scope = input.scope
    if (!scope.gameKind || !scope.gameRoomId || !scope.settlementId || !["points", "practice"].includes(scope.funding) || !int(input.expectedRevision) || !int(input.revision) || input.revision < input.expectedRevision) fail()
    await this.lock(tx, scope)
    const lots = await collect(after => tx.gameReserveLot.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    const claims = await collect(after => tx.gameReserveClaim.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    const movements = await collect(after => tx.gameReserveMovement.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    const current = lots.reduce((n, l) => Math.max(n, l.revision), 0), retry = current === input.revision
    if (!retry && (current !== input.expectedRevision || input.revision <= current)) fail()
    for (const list of [input.lots, input.claims, input.movements]) if (new Set(list.map(r => r.id)).size !== list.length) fail()
    if (lots.some(l => !input.lots.some(n => n.id === l.id)) || claims.some(c => !input.claims.some(n => n.id === c.id))) fail()
    const newMovements = input.movements.filter(m => !movements.some(old => old.id === m.id))
    for (const movement of input.movements) {
      if (!movement.id || !int(movement.amount) || !movement.amount || !int(movement.eventIndex) || !["deposit", "steal", "refund", "finalize"].includes(movement.kind)) fail()
      const prior = movements.find(m => m.id === movement.id || m.rootActionId === movement.rootActionId && m.eventIndex === movement.eventIndex)
      if (prior && !same(prior, { ...scope, ...movement })) fail()
      if (!input.lots.some(l => l.id === movement.lotId) || movement.kind !== "deposit" && !input.claims.some(c => c.id === movement.claimId && c.lotId === movement.lotId)) fail()
    }
    for (const lot of input.lots) {
      if (!lot.id || !lot.sourceId || !lot.payerAdmissionId || !lot.payerUserId || !int(lot.sourceSeq) || !int(lot.originalAmount) || !lot.originalAmount || !int(lot.remainingAmount) || lot.remainingAmount > lot.originalAmount) fail()
      const prior = lots.find(l => l.id === lot.id), { remainingAmount: _amount, ...identity } = lot
      if (prior && !same(prior, { ...scope, ...identity })) fail()
      const recipients = input.claims.filter(c => c.lotId === lot.id)
      if (new Set(recipients.map(c => c.admissionId)).size !== recipients.length || recipients.reduce((n, c) => n + c.originalAmount, 0) !== lot.originalAmount || recipients.reduce((n, c) => n + c.remainingAmount, 0) !== lot.remainingAmount) fail()
      if (!retry) {
        const incoming = newMovements.filter(m => m.lotId === lot.id && m.kind === "deposit").reduce((n, m) => n + m.amount, 0)
        const outgoing = newMovements.filter(m => m.lotId === lot.id && m.kind !== "deposit").reduce((n, m) => n + m.amount, 0)
        if ((prior?.remainingAmount ?? 0) + incoming - outgoing !== lot.remainingAmount || (prior ? incoming !== 0 : incoming !== lot.originalAmount)) fail()
      } else if (!prior || prior.remainingAmount !== lot.remainingAmount) fail()
    }
    for (const claim of input.claims) {
      if (!claim.id || !claim.admissionId || !claim.userId || !int(claim.originalAmount) || !int(claim.remainingAmount) || claim.remainingAmount > claim.originalAmount || !input.lots.some(l => l.id === claim.lotId)
        || !["pending", "finalized"].includes(claim.status) || claim.status === "finalized" && claim.remainingAmount !== 0) fail()
      const prior = claims.find(c => c.id === claim.id), { remainingAmount: _amount, status: _status, ...identity } = claim
      if (prior && (!same(prior, { ...scope, ...identity }) || prior.status === "finalized" && claim.status !== "finalized")) fail()
      if (!retry) {
        const outgoing = newMovements.filter(m => m.claimId === claim.id && m.kind !== "deposit").reduce((n, m) => n + m.amount, 0)
        if ((prior?.remainingAmount ?? claim.originalAmount) - outgoing !== claim.remainingAmount) fail()
      } else if (!prior || prior.remainingAmount !== claim.remainingAmount || prior.status !== claim.status) fail()
    }
    if (retry) { if (newMovements.length) fail(); return }
    for (const lot of input.lots) {
      const status = input.claims.filter(c => c.lotId === lot.id).every(c => c.status === "finalized") ? "finalized" : "pending"
      await tx.gameReserveLot.upsert({ where: { id: lot.id }, create: { ...scope, ...lot, revision: input.revision, status }, update: { remainingAmount: lot.remainingAmount, revision: input.revision, status } })
    }
    for (const claim of input.claims) await tx.gameReserveClaim.upsert({ where: { id: claim.id }, create: { ...scope, ...claim }, update: { remainingAmount: claim.remainingAmount, status: claim.status } })
    for (const movement of newMovements) {
      await tx.gameReserveMovement.createMany({ data: [{ ...scope, ...movement }], skipDuplicates: true })
      const stored = await tx.gameReserveMovement.findUniqueOrThrow({ where: { settlementId_rootActionId_eventIndex: { settlementId: scope.settlementId, rootActionId: movement.rootActionId, eventIndex: movement.eventIndex } } })
      if (!same(stored, { ...scope, ...movement })) fail()
    }
  }
  /** Solidify residual shares once; return immutable intents for Hall's existing freeze/release. */
  async finalize(tx: Prisma.TransactionClient, settlementId: string): Promise<readonly PendingTransferInput[]> {
    let lots = await collect(after => tx.gameReserveLot.findMany({ where: { settlementId, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    if (!lots.length) return []
    const first = lots[0], scope: GameReserveScope = { gameKind: first.gameKind, gameRoomId: first.gameRoomId, settlementId, funding: first.funding === "points" ? "points" : "practice" }
    if (lots.some(l => !same(l, scope))) fail()
    await this.lock(tx, scope)
    lots = await collect(after => tx.gameReserveLot.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    const claims = await collect(after => tx.gameReserveClaim.findMany({ where: { ...scope, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    for (const lot of lots) if (claims.filter(c => c.lotId === lot.id).reduce((n, c) => n + c.remainingAmount, 0) !== lot.remainingAmount) fail()
    if (claims.some(c => c.status === "pending")) {
      const revision = lots.reduce((n, l) => Math.max(n, l.revision), 0) + 1, rootActionId = `reserve-final:${settlementId}`
      for (let i = 0; i < claims.length; i++) {
        const claim = claims[i]
        if (claim.status !== "pending") continue
        if (claim.remainingAmount > 0) {
          const id = createHash("sha256").update(JSON.stringify([rootActionId, claim.id])).digest("hex")
          const movement = { id, ...scope, rootActionId, eventIndex: i, lotId: claim.lotId, claimId: claim.id, kind: "finalize", amount: claim.remainingAmount, toAdmissionId: claim.admissionId }
          await tx.gameReserveMovement.createMany({ data: [movement], skipDuplicates: true })
          const stored = await tx.gameReserveMovement.findUniqueOrThrow({ where: { settlementId_rootActionId_eventIndex: { settlementId, rootActionId, eventIndex: i } } })
          if (!same(stored, movement)) fail()
        }
        await tx.gameReserveClaim.update({ where: { id: claim.id }, data: { status: "finalized", remainingAmount: 0 } })
      }
      await tx.gameReserveLot.updateMany({ where: scope, data: { status: "finalized", remainingAmount: 0, revision } })
    }
    const movements = await collect(after => tx.gameReserveMovement.findMany({ where: { ...scope, kind: "finalize", ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 1000 }))
    const totals = new Map<string, PendingTransferInput>()
    for (const movement of movements) {
      const claim = claims.find(c => c.id === movement.claimId && c.admissionId === movement.toAdmissionId) ?? fail()
      const prior = totals.get(claim.admissionId)
      if (prior && prior.userId !== claim.userId) fail()
      const amount = (prior?.amount ?? 0) + movement.amount
      if (!int(amount)) fail()
      totals.set(claim.admissionId, { ...scope, sourceId: `reserve:${settlementId}`, admissionId: claim.admissionId, userId: claim.userId, amount })
    }
    return [...totals.values()].sort((a, b) => a.admissionId.localeCompare(b.admissionId))
  }
  async pending(tx: Prisma.TransactionClient, userId: string): Promise<number> {
    const result = await tx.gameReserveClaim.aggregate({ where: { userId, funding: "points", status: "pending" }, _sum: { remainingAmount: true } })
    return result._sum.remainingAmount ?? 0
  }
}
