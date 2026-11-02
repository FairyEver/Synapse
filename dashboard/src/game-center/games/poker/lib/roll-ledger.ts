import type { PokerRollLedger, PokerRollLedgerPlayer } from "@synapse/shared/game-contracts"

export type RollLedgerFilter = { direction: "source" | "destination"; key: string }
export type RollLedgerAmount = PokerRollLedgerPlayer & { amount: number; count: number }

export function summarizeRollLedger(ledger: PokerRollLedger) {
  const sources = new Map<string, RollLedgerAmount>(), destinations = new Map<string, RollLedgerAmount>()
  const players = new Map(ledger.players.map(player => [player.key, player]))
  function add(target: Map<string, RollLedgerAmount>, key: string, value: number) {
    if (!value) return
    const row = target.get(key) ?? { ...players.get(key)!, amount: 0, count: 0 }
    row.amount += value
    row.count++
    target.set(key, row)
  }
  let total = 0
  for (const entry of ledger.entries) {
    total += entry.fee
    add(sources, entry.payerKey, entry.fee)
    for (const share of entry.compensations) add(destinations, share.key, share.amount)
  }
  const order = (a: RollLedgerAmount, b: RollLedgerAmount) => b.amount - a.amount || a.seatNo - b.seatNo
  return { total, sources: [...sources.values()].sort(order), destinations: [...destinations.values()].sort(order) }
}

export function selectRollLedgerEntries(ledger: PokerRollLedger, filter: RollLedgerFilter | null) {
  return ledger.entries.flatMap((entry, index) => {
    if (filter?.direction === "source" && entry.payerKey !== filter.key) return []
    const share = filter?.direction === "destination" ? entry.compensations.find(row => row.key === filter.key) : undefined
    if (filter?.direction === "destination" && !share?.amount) return []
    return [{ entry, index: index + 1, amount: share?.amount ?? entry.fee }]
  })
}
