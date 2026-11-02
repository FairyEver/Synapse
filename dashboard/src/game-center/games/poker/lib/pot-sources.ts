import type { PokerTableView } from "@synapse/shared/game-contracts"

export function potSourcesView(table: PokerTableView) {
  const sources = table.potContributions
  if (!sources || sources.handId !== table.handId) return undefined
  return {
    total: sources.total,
    status: sources.status,
    players: sources.players.filter(player => player.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.seatNo - b.seatNo)
      .map(player => ({ ...player, percentage: sources.total > 0 ? (player.amount / sources.total * 100).toFixed(1) : "0.0" })),
  }
}
