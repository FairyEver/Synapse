import type { PokerSettlementView, PokerTableView } from "@synapse/shared/game-contracts"
export function settlementView(settlement: PokerSettlementView) {
  const pots = settlement.pots.filter(p => !p.refund)
  const winners = new Set(pots.flatMap(p => p.winners))
  const won = settlement.seats.filter(s => winners.has(s.seatNo))
  const mine = settlement.seats.find(s => s.isMe)
  const title = won.length > 1 ? `${won.map(s => s.isMe ? "你" : s.displayName).join("、")}${pots.length === 1 ? "平分底池" : "分别收池"}`
    : won.length === 1 ? `${won[0].isMe ? "你" : won[0].displayName}赢下了本局` : "本局已结束"
  return { pots, winners, won, mine, title, total: pots.reduce((n, p) => n + p.amount, 0) }
}
export function readinessView(table: PokerTableView) {
  const seats = table.seats.filter(s => !s.isHistorical && s.nextHandEligible)
  const mine = seats.find(s => s.isMe && s.seatNo === table.mySeatNo)
  return { seats, mine, ready: seats.filter(s => s.readyForNextHand).length }
}
export const invested = (seat: PokerSettlementView["seats"][number]) => Math.max(0, seat.payout - seat.delta)
