import type { PokerSettlementView } from "@synapse/shared/game-contracts"
import { Trophy } from "lucide-react"
import { Card } from "./Card"
import { amount } from "../lib/view"
export function Settlement({ settlement, compact = false }: { settlement: PokerSettlementView; compact?: boolean }) {
  const winners = new Set(settlement.pots.filter(p => !p.refund).flatMap(p => p.winners))
  if (!compact) {
    const won = settlement.seats.filter(seat => winners.has(seat.seatNo))
    const mine = settlement.seats.find(seat => seat.isMe)
    return <section className="poker-settlement" data-profit={(mine?.delta ?? 0)>0} aria-label={`第 ${settlement.handNo} 手结果`}>
      <span className="poker-settlement-heading">第 {settlement.handNo} 手结束</span>
      <strong title={won.map(seat => seat.displayName).join("、")}>{won.map(seat => seat.displayName).join("、")} 获胜</strong>
      <span>{[...new Set(won.map(seat => seat.handName).filter(Boolean))].join(" · ")}</span>
      {mine && <b>本手净变化 {mine.delta > 0 ? "+" : ""}{amount(mine.delta)}</b>}
    </section>
  }
  return <section className="poker-result-log space-y-3 border-b border-separator py-4 font-sans text-sm text-foreground" aria-label={`第 ${settlement.handNo} 手结果`}>
    <strong>第 {settlement.handNo} 手结果{settlement.mixedControl && " · 人机混合"}</strong>
    <div className="divide-y divide-separator">
      {settlement.seats.map(s => <div key={s.seatNo} className="flex flex-wrap items-center gap-2 py-2">
        <span className="flex min-w-0 basis-full items-center gap-2 break-words"><span className="min-w-0">{s.displayName}{s.isMe && " · 本人"}</span>{winners.has(s.seatNo) && <Trophy className="size-4 shrink-0 text-accent" role="img" aria-label="获胜" />}</span>
        <span className="flex gap-1" data-card-size="xs">{s.hole?.map(card => <Card key={card} card={card} faceUp />)}</span>
        <span>{s.folded ? "已弃牌" : s.handName ?? ""}</span>
        <b className="ml-auto tabular-nums">{s.delta > 0 ? "+" : ""}{amount(s.delta)}</b>
      </div>)}
    </div>
    {settlement.pots.map((pot, i) => <p key={i} className="break-words text-xs text-muted">{pot.refund ? "未跟注返还" : i === 0 ? "主池" : `边池 ${i}`} {amount(pot.amount)}{Object.entries(pot.shares).map(([seat,share]) => ` · ${settlement.seats.find(s => s.seatNo === Number(seat))?.displayName ?? `座位 ${Number(seat)+1}`} ${amount(share)}`)}</p>)}
  </section>
}
