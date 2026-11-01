import type { PokerSettlementView } from "@synapse/shared/game-contracts"
import { compareHands, evaluate } from "./engine/hand"
type Pot = PokerSettlementView["pots"][number]
export function settlementReason(pot: Pot, settlement: PokerSettlementView): string {
  if (pot.refund) return "未被跟注的筹码返还，不计为赢得底池。"
  const winners = settlement.seats.filter(s => pot.winners.includes(s.seatNo))
  if (!winners.length) return "历史记录未提供完整分配信息。"
  if (pot.eligible.length === 1) return "其他玩家均已弃牌，无需摊牌。"
  if (winners.length > 1) return `${winners.map(s => s.displayName).join("、")}的牌力相同，平分此底池。`
  const winner = winners[0], variant = settlement.rules.variant
  const opponents = settlement.seats.filter(s => pot.eligible.includes(s.seatNo) && s.seatNo !== winner.seatNo && !s.folded && s.bestFive)
    .sort((a, b) => compareHands(b.bestFive!, a.bestFive!, variant))
  const opponent = opponents[0]
  if (!winner.bestFive || !opponent) return `${winner.displayName}赢得此底池。`
  const a = evaluate(winner.bestFive, variant), b = evaluate(opponent.bestFive!, variant)
  const prefix = variant === "short32" ? "短牌规则：" : ""
  if (a.category !== b.category) return `${prefix}${winner.displayName}的${winner.handName}胜过${opponent.displayName}的${opponent.handName}。`
  const different = a.kickers.findIndex((rank, i) => rank !== b.kickers[i])
  if (different < 0) return `${winner.displayName}赢得此底池。`
  const symbol = (rank: number) => rank > 10 ? "JQKA"[rank - 11] : String(rank)
  return `同为${winner.handName}，逐项比较至 ${symbol(a.kickers[different])} 和 ${symbol(b.kickers[different])}，${symbol(a.kickers[different])} 更大。`
}
