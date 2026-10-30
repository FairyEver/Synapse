import type { PokerSettlementView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount } from "../lib/view"
export function Settlement({ settlement, compact = false }: { settlement: PokerSettlementView; compact?: boolean }) {
  const winners = new Set(settlement.pots.filter(p => !p.refund).flatMap(p => p.winners))
  if (!compact) {
    const won = settlement.seats.filter(seat => winners.has(seat.seatNo))
    const mine = settlement.seats.find(seat => seat.isMe)
    return <section className="poker-settlement" aria-label={`第 ${settlement.handNo} 手结果`}>
      <span className="poker-settlement-heading">第 {settlement.handNo} 手结束</span>
      <strong title={won.map(seat => seat.displayName).join("、")}>{won.map(seat => seat.displayName).join("、")} 获胜</strong>
      <span>{[...new Set(won.map(seat => seat.handName).filter(Boolean))].join(" · ")}</span>
      {mine && <b>本手 {mine.delta > 0 ? "+" : ""}{amount(mine.delta)}</b>}
    </section>
  }
  return <section className={compact ? "poker-result-log" : "poker-settlement"} aria-label={`第 ${settlement.handNo} 手结果`}>
    <strong>第 {settlement.handNo} 手结果{settlement.mixedControl && " · 人机混合"}</strong>
    {settlement.seats.map(s => <div key={s.seatNo} className="poker-winner"><span>{s.displayName}{s.isMe && " · 本人"}{winners.has(s.seatNo) && " · 获胜"}</span>{s.hole && <span className="poker-result-cards" data-card-size="xs">{s.hole.map(card => <Card key={card} card={card} faceUp />)}</span>}<span>{s.folded ? "已弃牌" : s.handName ?? (winners.has(s.seatNo) ? "获胜" : "")}</span><b>{s.delta > 0 ? "+" : ""}{amount(s.delta)}</b></div>)}
    {settlement.pots.map((pot, i) => <p key={i}>{pot.refund ? "未跟注返还" : i === 0 ? "主池" : `边池 ${i}`} {amount(pot.amount)}{Object.entries(pot.shares).map(([seat,share]) => ` · ${settlement.seats.find(s => s.seatNo === Number(seat))?.displayName ?? `座位 ${Number(seat)+1}`} ${amount(share)}`)}</p>)}
  </section>
}
