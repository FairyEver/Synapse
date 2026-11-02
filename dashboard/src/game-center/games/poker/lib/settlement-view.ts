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
  const ready = seats.filter(s => s.readyForNextHand).length
  const waiting = seats.filter(s => !s.readyForNextHand)
  const names = waiting.slice(0, 2).map(s => s.isMe ? "你" : s.displayName).join("、")
  const waitingLabel = waiting.length ? `等待 ${names}${waiting.length > 2 ? ` 等 ${waiting.length} 人` : ""}` : seats.length < 2 ? "等待玩家入座" : "等待房主开始"
  return { seats, mine, ready, summary: `已准备 ${ready} / ${seats.length} · ${waitingLabel}` }
}
export const invested = (seat: PokerSettlementView["seats"][number]) => Math.max(0, seat.payout - (seat.pokerDelta ?? (seat.delta + (seat.rollPaid ?? 0) - (seat.rollReceived ?? 0))))
