import type { PokerTableView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount } from "../lib/view"

export function BetDecisionContext({ table }: { table: PokerTableView }) {
  const mine = table.seats.find(seat => seat.seatNo === table.mySeatNo)
  return <section aria-label="下注决策信息" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3" data-card-size="xs">
      <div className="space-y-1"><span className="text-xs text-muted">手牌</span><div className="flex gap-1">{mine?.hole?.map((card, index) => <Card key={index} card={card} />)}</div></div>
      <div className="space-y-1"><span className="text-xs text-muted">公共牌</span><div className="flex gap-1">{Array.from({ length: 5 }, (_, index) => <Card key={index} card={table.board[index]} />)}</div></div>
    </div>
    <dl className="grid grid-cols-3 gap-3 text-sm tabular-nums">{[["底池", table.pot], ["筹码", mine?.stack ?? 0], ["跟注", table.toCall ?? 0]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd>{amount(Number(value))}</dd></div>)}</dl>
  </section>
}
