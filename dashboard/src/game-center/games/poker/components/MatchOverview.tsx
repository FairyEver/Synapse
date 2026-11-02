import { Accordion } from "@heroui/react"
import type { PokerSettlementView, PokerTableView } from "@synapse/shared/game-contracts"
import { matchOverview } from "../lib/match-information"
import { amount, streetLabel } from "../lib/view"
import { PokerCardStatuses } from "./PokerCardStatuses"
import { Settlement } from "./Settlement"

const value = (n: number | undefined) => n === undefined ? "暂不可用" : amount(n)
function Metric({ label, value: n, unit }: { label: string; value?: number; unit?: string }) {
  return <dl aria-label={label} className="min-w-0 space-y-1"><dt className="text-xs text-muted">{label}</dt><dd className="text-xl font-semibold tabular-nums wrap-anywhere">{value(n)}{n !== undefined && unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}</dd></dl>
}
export function MatchOverview({ table, perspective, settlement }: { table: PokerTableView; perspective: "owner" | "public"; settlement?: PokerSettlementView }) {
  const summary = matchOverview(table), unit = table.mode === "practice" ? "筹码" : "点数"
  const me = perspective === "owner" && table.handId ? table.seats.find(s => s.isMe && s.seatNo === table.mySeatNo && s.inCurrentHand === true && !s.isHistorical && s.status !== "left") : undefined
  const receivedLabel = summary.rollStatus === "released" ? "已收补偿" : summary.rollStatus === "cancelled" ? "补偿已取消" : "待收补偿"
  return <section className="min-w-0 space-y-5 py-4" aria-label="本手总览">
    <div className="grid grid-cols-3 gap-3"><Metric label="累计下注" value={summary.bet} unit={unit} /><Metric label="Roll 花费" value={summary.roll} unit={unit} /><Metric label="Roll 次数" value={summary.count} unit="次" /></div>
    {me && <dl aria-label="本手筹码" className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-separator py-4 text-sm">
      <dt className="text-muted">可用{unit}</dt><dd className="text-right tabular-nums">{amount(me.stack)}</dd>
      {me.pendingCompensation != null && <><dt className="text-muted">本手暂存待分</dt><dd className="text-right tabular-nums">{amount(me.pendingCompensation)}</dd></>}
    </dl>}
    <section className="space-y-3" aria-label="玩家本手累计"><h3 className="text-sm font-medium">玩家本手累计</h3>
      {!summary.players.length ? <p className="text-sm text-muted">玩家累计暂不可用</p> : summary.players.map(p => <article key={p.key} className="min-w-0 space-y-3 border-b border-separator py-4 text-sm">
        <div className="flex min-w-0 items-start justify-between gap-3"><h4 className="min-w-0 font-medium wrap-anywhere">{p.displayName}{p.isMe && <span className="ml-2 text-xs font-normal text-muted">你</span>}</h4>{p.folded && <span className="shrink-0 text-xs text-muted">已弃牌</span>}</div>
        <dl className="grid grid-cols-3 gap-3"><div><dt className="text-xs text-muted">下注</dt><dd className="font-medium tabular-nums wrap-anywhere">{value(p.bet)}</dd></div><div><dt className="text-xs text-muted">Roll 次数</dt><dd className="font-medium tabular-nums wrap-anywhere">{value(p.count)}</dd></div><div><dt className="text-xs text-muted">Roll 花费</dt><dd className="font-medium tabular-nums wrap-anywhere">{value(p.paid)}</dd></div></dl>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>普通 {value(p.normal)} 次 · 超级 {value(p.super)} 次</span><span>{receivedLabel} <b className="font-medium text-foreground tabular-nums">{value(p.received)}</b></span></div>
        <Accordion><Accordion.Item id={p.key}><Accordion.Heading><Accordion.Trigger>按轮次拆分<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
          <Accordion.Panel><Accordion.Body><div className="overflow-x-auto"><table className="w-full text-right text-xs tabular-nums" aria-label={`${p.displayName}各轮投入`}><thead><tr className="text-muted"><th scope="col" className="py-2 text-left font-normal">轮次</th><th scope="col" className="font-normal">下注</th><th scope="col" className="font-normal">Roll 次数</th><th scope="col" className="font-normal">花费</th></tr></thead><tbody>{p.rounds.map(r => <tr key={r.street}><th scope="row" className="py-2 text-left font-normal">{streetLabel[r.street]}</th><td>{value(r.bet)}</td><td>{value(r.count)}</td><td>{value(r.paid)}</td></tr>)}</tbody></table></div></Accordion.Body></Accordion.Panel>
        </Accordion.Item></Accordion>
      </article>)}
    </section>
    {table.reserve && <Metric label="当前暂存" value={table.reserve.total} unit={unit} />}
    {table.cards && <PokerCardStatuses cards={table.cards} seats={table.seats} />}
    {settlement && <Settlement settlement={settlement} compact />}
  </section>
}
