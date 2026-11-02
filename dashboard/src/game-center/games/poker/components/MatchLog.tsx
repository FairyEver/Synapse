import { Accordion } from "@heroui/react"
import type { PokerHandLogEntry, PokerTableView } from "@synapse/shared/game-contracts"
import { Check, ChevronsUp, CircleDollarSign, Coins, CornerDownRight, Plus, Shuffle, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react"
import { bettingStreets, matchLog, reachedStreets } from "../lib/match-information"
import { actionLabel, amount, streetLabel } from "../lib/view"
import { Card } from "./Card"

const rollStatus = { pending: "待选牌，费用已支付", completed: "已完成", replaced: "已重新抽取，费用不退", cancelled: "本手已取消" }
const blindLabels: Record<string, string> = { small_blind: "小盲", big_blind: "大盲" }
const actionIcons: Record<PokerHandLogEntry["action"], LucideIcon> = {
  small_blind: CircleDollarSign,
  big_blind: Coins,
  fold: X,
  check: Check,
  call: CornerDownRight,
  bet: Plus,
  raise: TrendingUp,
  allin: ChevronsUp,
  roll: Shuffle,
}
function LogActionIcon({ entry }: { entry: PokerHandLogEntry }) {
  const Icon = entry.roll?.kind === "super" ? Sparkles : actionIcons[entry.action]
  return <span className="flex size-5 shrink-0 items-center justify-center text-muted" aria-hidden="true"><Icon className="size-4" /></span>
}
export function MatchLog({ table }: { table: PokerTableView }) {
  const log = matchLog(table)
  const current = bettingStreets.indexOf(table.street as typeof bettingStreets[number])
  const reached = reachedStreets(table, log.entries)
  const boardCount = { preflop: 0, flop: 3, turn: 4, river: 5 }
  return <section className="min-w-0 space-y-4 py-4" aria-label="本手日志">
    {!log.complete && <p className="text-xs text-muted">完整日志暂不可用，以下仅显示已取得的行动记录。</p>}
    {!table.handId || !reached.length ? <p className="py-6 text-sm text-muted">暂无行动</p> : <>
      <p className="text-xs text-muted">金额单位：{table.mode === "practice" ? "筹码" : "点数"} · 按发生顺序</p>
      <Accordion key={table.handId} allowsMultipleExpanded defaultExpandedKeys={bettingStreets}>
        {reached.map(street => <Accordion.Item id={street} key={street}>
          <Accordion.Heading><Accordion.Trigger>
            <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">{streetLabel[street]}{table.street === street && <span className="text-xs font-normal text-muted">进行中</span>}</span>
              <span className="flex gap-1" data-card-size="xs">{table.board.slice(0, boardCount[street]).map(card => <Card key={card} card={card} />)}</span>
            </span><Accordion.Indicator />
          </Accordion.Trigger></Accordion.Heading>
          <Accordion.Panel><Accordion.Body>
            {!log.entries.some(e => e.street === street) && <p className="py-3 text-sm text-muted">{log.complete ? "本轮暂无行动" : "暂无已取得的行动记录"}</p>}
            <ol className="divide-y divide-separator text-sm" aria-label={`${streetLabel[street]}行动记录`}>
              {log.entries.filter(e => e.street === street).map(entry => <li key={entry.seq} data-log-seq={entry.seq} className="flex min-w-0 items-start gap-3 py-3">
                <LogActionIcon entry={entry} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="wrap-anywhere">{entry.displayName} · {entry.roll ? entry.roll.kind === "super" ? "超级 Roll" : "普通 Roll" : blindLabels[entry.action] ?? actionLabel[entry.action] ?? entry.action}</span>
                  {entry.roll ? <small className="text-muted">本手第 {entry.roll.count} 次 · {rollStatus[entry.roll.status]}</small> :
                    entry.isAuto || entry.actionSource ? <small className="text-muted">{entry.isAuto ? "自动行动" : entry.actionSource === "human" ? "真人操作" : entry.actionSource === "rules_bot" ? "机器人" : "AI 操作"}</small> : null}
                </span>
                <span className="flex max-w-1/3 shrink-0 flex-col items-end text-right tabular-nums wrap-anywhere"><strong>{amount(entry.amount)}</strong><small className="text-muted">{entry.roll ? "花费" : entry.amount ? "追加" : "不追加"}</small></span>
              </li>)}
            </ol>
          </Accordion.Body></Accordion.Panel>
        </Accordion.Item>)}
      </Accordion>
      {table.status === "running" && current >= 0 && current < 3 && <p className="text-sm text-muted">{streetLabel[bettingStreets[current + 1]]}尚未开始</p>}
    </>}
  </section>
}
