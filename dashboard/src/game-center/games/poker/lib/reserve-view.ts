import type { PokerReserveView, PokerTableView } from "@synapse/shared/game-contracts"
export type ReserveFilter = { payerKey?: string; beneficiaryKey?: string; sourceType?: string } | null
export type ReserveRow = { id: string; seq: number; kind: PokerReserveView["movements"][number]["kind"]; amount: number; payerName: string; beneficiaryNames: string[]; recipientName?: string; sourceType: string }
export function projectReserveRows(view: PokerReserveView, filter: ReserveFilter): ReserveRow[] {
  const players = new Map(view.players.map(p => [p.key, p.displayName])), lots = new Map(view.lots.map(l => [l.id, l]))
  return [...view.movements].sort((a, b) => a.seq - b.seq).flatMap(movement => {
    const lot = lots.get(movement.lotId)
    if (!lot || !players.has(lot.payerKey) || filter?.payerKey && filter.payerKey !== lot.payerKey || filter?.sourceType && filter.sourceType !== lot.sourceType || filter?.beneficiaryKey && (movement.beneficiaryKey ? movement.beneficiaryKey !== filter.beneficiaryKey : !lot.shares.some(s => s.key === filter.beneficiaryKey))) return []
    return [{ id: movement.id, seq: movement.seq, kind: movement.kind, amount: movement.amount, payerName: players.get(lot.payerKey)!, beneficiaryNames: (movement.beneficiaryKey ? [movement.beneficiaryKey] : lot.shares.map(s => s.key)).map(key => players.get(key) ?? "未知玩家"), recipientName: movement.recipientKey ? players.get(movement.recipientKey) : undefined, sourceType: lot.sourceType }]
  })
}
export const reserveKindLabel = { deposit: "存入", steal: "盗取", refund: "退款", finalize: "分配" }
export const reserveSourceLabel = (source: string) => ({ roll: "Roll", card: "卡牌" }[source] ?? "其他")
/** Legacy frozen compensation is read-only source data, never migrated into the new ledger. */
export function tableReserveView(table: PokerTableView): PokerReserveView | undefined {
  if (table.reserve?.handId === table.handId) return table.reserve
  const ledger = table.rollLedger
  if (!ledger || ledger.handId !== table.handId) return undefined
  const pending = ledger.status === "pending", lots = ledger.entries.map(entry => ({ id: entry.id, payerKey: entry.payerKey, sourceType: "roll", originalAmount: entry.fee, remainingAmount: pending ? entry.fee : 0, shares: entry.compensations.map(share => ({ key: share.key, originalAmount: share.amount, remainingAmount: pending ? share.amount : 0 })) }))
  return { handId: ledger.handId, status: ledger.status, total: pending ? ledger.entries.reduce((sum, e) => sum + e.fee, 0) : 0, complete: true,
    players: ledger.players.map(player => ({ key: player.key, seatNo: player.seatNo, displayName: player.displayName, isMe: player.isMe, pending: lots.reduce((sum, lot) => sum + (lot.shares.find(s => s.key === player.key)?.remainingAmount ?? 0), 0) })), lots,
    movements: ledger.entries.flatMap((entry, index) => [{ id: `${entry.id}:deposit`, seq: index * 11, lotId: entry.id, kind: "deposit" as const, amount: entry.fee, actorKey: entry.payerKey }, ...(ledger.status === "released" ? entry.compensations.map((share, i) => ({ id: `${entry.id}:${share.key}`, seq: index * 11 + i + 1, lotId: entry.id, kind: "finalize" as const, amount: share.amount, recipientKey: share.key })) : [])]),
  }
}
