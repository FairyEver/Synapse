import { useRef, useState } from "react"
import { Accordion, Button, Chip, Tabs } from "@heroui/react"
import { Trophy } from "lucide-react"
import type { PokerSettlementView } from "@synapse/shared/game-contracts"
import { Card } from "./Card"
import { amount } from "../lib/view"
import { invested, settlementView } from "../lib/settlement-view"
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${amount(Math.abs(n))}`
export function SettlementDetails({ settlement }: { settlement: PokerSettlementView }) {
  const view = settlementView(settlement)
  const [selected, setSelected] = useState(view.won[0]?.seatNo ?? settlement.seats[0]?.seatNo)
  const best = useRef<HTMLElement>(null)
  const player = settlement.seats.find(s => s.seatNo === selected)
  const shortDeck = settlement.rules.variant === "short32"
  const ranks = ["皇家同花顺", "同花顺", "四条", ...(shortDeck ? ["同花", "葫芦"] : ["葫芦", "同花"]), "顺子", "三条", "两对", "一对", "高牌"]
  const choose = (seatNo: number) => { setSelected(seatNo); requestAnimationFrame(() => best.current?.scrollIntoView({ block: "nearest" })) }
  return <div className="poker-result-details">
    <section className="poker-result-outcome" aria-label="本局输赢">
      <div className="poker-result-winner"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground"><Trophy aria-hidden="true" /></span><div className="min-w-0"><h2>{view.title}</h2><p className="text-sm text-muted">{view.pots[0]?.reason ?? "查看全员结算和底池分配"}</p></div></div>
      {view.mine && <div className="poker-result-net"><span className="text-xs text-muted">你的本局净{view.mine.delta > 0 ? "赢" : view.mine.delta < 0 ? "输" : "变化"}</span><strong className={view.mine.delta > 0 ? "text-success-soft-foreground" : ""}>{signed(view.mine.delta)}<small className="text-muted">点数</small></strong><span className="text-xs text-muted">收回 {amount(view.mine.payout)} − 投入 {amount(invested(view.mine))}</span></div>}
    </section>
    <section className="poker-result-board" aria-label="公共牌"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>公共牌</span><span className="text-muted">底池 {amount(view.total)}</span></div><div className="poker-result-cards" data-card-size="sm">{Array.from({ length: 5 }, (_, i) => <Card key={i} card={settlement.board[i]} />)}</div></section>
    {player?.bestFive && <section ref={best} className="poker-result-best rounded-xl bg-surface-secondary" aria-label={`${player.displayName}的最佳五张牌`} aria-live="polite">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3>{player.displayName}{player.isMe ? "（你）" : ""}的最佳五张</h3>{view.winners.has(player.seatNo) && <Chip color="accent" variant="soft" size="sm">收池</Chip>}</div><strong className="mt-2 block text-xl">{player.handName}</strong></div>
      <div className="poker-result-cards" data-card-size="sm">{player.bestFive.map(card => <span key={card} className="poker-result-card-source" data-hole={player.hole?.includes(card)}><Card card={card} /><small>{player.hole?.includes(card) ? "手牌" : "公共牌"}</small></span>)}</div>
    </section>}
    <Accordion className="mb-5" key={settlement.handId}>
      <Accordion.Item id="hand-ranks">
        <Accordion.Heading><Accordion.Trigger>查看牌型大小<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
        <Accordion.Panel><Accordion.Body>
          <div className="space-y-3 text-sm">
            <p className="font-medium">{shortDeck ? "32 张短牌" : "标准德州扑克"} · 从大到小</p>
            <ol className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2" aria-label="牌型从大到小">
              {ranks.map((rank, index) => <li key={rank} className="flex items-baseline gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-muted" aria-hidden="true">{index + 1}</span><span>{rank}</span></li>)}
            </ol>
            <p className="text-muted">比较最好的五张牌；同牌型逐项比点数，花色不分大小。{shortDeck ? "短牌 A、7、8、9、10 可组成最小顺子。" : "A、2、3、4、5 可组成最小顺子。"}</p>
          </div>
        </Accordion.Body></Accordion.Panel>
      </Accordion.Item>
    </Accordion>
    <Tabs variant="secondary" className="min-w-0 w-full"><Tabs.ListContainer><Tabs.List aria-label="结算详情"><Tabs.Tab id="players">全员结算 {settlement.seats.length}<Tabs.Indicator /></Tabs.Tab><Tabs.Tab id="pots">底池分配 {settlement.pots.length}<Tabs.Indicator /></Tabs.Tab></Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="players" className="pt-3"><ul className="poker-result-players" aria-label="全员结算">
        {settlement.seats.map(s => <li key={s.seatNo} className="poker-result-player" data-player-seat={s.seatNo}>
          <div className="poker-result-player-name"><div className="flex flex-wrap items-center gap-2"><strong>{s.displayName}</strong>{s.isMe && <span className="text-xs text-muted">你</span>}{view.winners.has(s.seatNo) && <Trophy className="size-4 shrink-0 text-accent" role="img" aria-label="收池玩家" />}</div><span className="text-xs text-muted">{s.folded ? "已弃牌" : s.handName ?? "无需摊牌"}</span></div>
          <div className="poker-result-hole" data-card-size="xs"><div className="flex gap-1"><Card card={s.hole?.[0]} faceUp={!!s.hole?.[0]} /><Card card={s.hole?.[1]} faceUp={!!s.hole?.[1]} /></div>{!s.hole && <span className="text-xs text-muted">未公开</span>}</div>
          <dl className="poker-result-money">{[["投入", invested(s)], ["收回", s.payout], ["净变化", s.delta], ["剩余", s.endingStack]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "净变化" && Number(value) > 0 ? "text-success-soft-foreground font-semibold" : ""}>{label === "净变化" ? signed(Number(value)) : amount(Number(value))}</dd></div>)}</dl>
          {s.bestFive && <Button size="sm" variant="ghost" aria-label={`查看${s.displayName}的最佳五张牌`} aria-pressed={selected === s.seatNo} onPress={() => choose(s.seatNo)}>比牌</Button>}
        </li>)}
      </ul><p className="mt-3 text-xs text-muted">未公开的手牌保持隐藏。收回包含底池分配及未跟注返还。</p></Tabs.Panel>
      <Tabs.Panel id="pots" className="pt-3"><div className="divide-y divide-separator">{settlement.pots.map((pot, i) => <section className="space-y-2 py-4" key={i}><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{pot.refund ? "未跟注返还" : i === 0 ? "主池" : `边池 ${i}`}</strong><strong className="tabular-nums">{amount(pot.amount)}</strong></div><p className="text-xs text-muted">{pot.reason}</p><p className="text-xs text-muted">参与：{pot.eligible.map(seatNo => settlement.seats.find(s => s.seatNo === seatNo)?.displayName ?? `座位 ${seatNo + 1}`).join("、")}</p><ul className="space-y-2">{Object.entries(pot.shares).map(([seatNo, share]) => <li key={seatNo} className="flex justify-between gap-4 text-sm"><span className="min-w-0">{settlement.seats.find(s => s.seatNo === Number(seatNo))?.displayName ?? `座位 ${Number(seatNo) + 1}`}</span><b className="shrink-0 tabular-nums">{amount(share)}</b></li>)}</ul></section>)}</div></Tabs.Panel>
    </Tabs>
  </div>
}
