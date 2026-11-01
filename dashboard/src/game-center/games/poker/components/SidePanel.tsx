import { ListOrdered, LockKeyhole } from "lucide-react"
import { useState } from "react"
import { Tabs } from "@heroui/react"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { Settlement } from "./Settlement"
import { PersonaBadge } from "./PersonaBadge"
import { rollEventLabel } from "../lib/roll-view"
import { actionLabel, amount, streetLabel } from "../lib/view"
export function SidePanel({
  table,
  perspective,
  id,
  events = [],
}: {
  events?: PokerTableEvent[]
  id?: string
  table: PokerTableView
  perspective: "owner" | "public"
}) {
  const myNote =
    perspective === "owner" ? [...table.recentActions].reverse().find((a) => a.note)?.note : null
  const settlements = new Map(events.flatMap(event => event.settlement ? [[event.handId, event.settlement] as const] : []))
  if (table.settlement) settlements.set(table.settlement.handId, table.settlement)
  const recentResults = [...settlements.values()].sort((a, b) => b.handNo - a.handNo).slice(0, 2)
  const [selectedTab, setSelectedTab] = useState("log")
  const canSeeAi = perspective === "owner" && table.mySeatNo !== null
  const myHandSeat = perspective === "owner" && table.handId
    ? table.seats.find(seat => seat.isMe && seat.seatNo === table.mySeatNo && !seat.isHistorical && seat.inCurrentHand === true && seat.status !== "left")
    : undefined
  const tab = selectedTab === "ai" && !canSeeAi ? "log" : selectedTab
  return (
    <aside id={id} className="h-full overflow-y-auto overscroll-contain p-4 pt-12 font-sans text-foreground scheme-light" aria-label="日志和AI判断">
      <Tabs selectedKey={tab} onSelectionChange={key => setSelectedTab(String(key))} variant="secondary" className="w-full">
        <Tabs.ListContainer><Tabs.List aria-label="牌局信息">
          <Tabs.Tab id="log">日志<Tabs.Indicator /></Tabs.Tab>
          {perspective === "owner" && table.mySeatNo !== null && <Tabs.Tab id="ai">AI 判断<Tabs.Indicator /></Tabs.Tab>}
        </Tabs.List></Tabs.ListContainer>
        <Tabs.Panel id="log">
      {myHandSeat?.pendingCompensation != null && <dl aria-label="本手筹码" className="grid grid-cols-2 gap-x-4 gap-y-2 py-4 text-sm">
        <dt className="text-muted">可用筹码</dt><dd className="text-right tabular-nums">{amount(myHandSeat.stack)}</dd>
        <dt className="text-muted">本手待结算补偿</dt><dd className="text-right tabular-nums">{amount(myHandSeat.pendingCompensation)}</dd>
      </dl>}
      {recentResults.map(result => <Settlement key={result.handId} settlement={result} compact />)}
      <section className="space-y-4 py-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ListOrdered className="size-4" aria-hidden="true" />
          日志
        </h3>
        {events.some(event=>event.roll) && <ol className="space-y-2 text-sm" aria-label="换牌日志">{events.filter(event=>event.roll).map(event=><li key={`${event.handId}:${event.seq}`}>{rollEventLabel(event.roll!)}</li>)}</ol>}
        {table.recentActions.length === 0 ? (
          <p className="text-sm text-muted">暂无行动</p>
        ) : (
          <ol className="divide-y divide-separator text-sm">
            {table.recentActions.map((action) => {
              const displayName = action.displayName ?? `座位 ${action.seatNo + 1}`
              return (
                <li key={`${table.handId}:${action.seq}`} className="flex min-w-0 items-start gap-3 py-3">
                  <span className="text-xs text-muted tabular-nums">{String(action.seq).padStart(2, "0")}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words" title={displayName}>{displayName}</span>
                    <small className="text-muted">
                      {streetLabel[action.street] ?? action.street}
                      {action.isAuto && " · 自动"}
                      {action.actionSource === "rules_bot" && " · 机器人"}
                      {action.actionSource === "human" && " · 真人操作"}
                    </small>
                    {perspective === "owner" && action.personaVersion && (
                      <PersonaBadge version={action.personaVersion} />
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {actionLabel[action.action] ?? action.action}
                    {action.amount > 0 && <strong>{amount(action.amount)}</strong>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
        </Tabs.Panel>
      {perspective === "owner" && table.mySeatNo !== null && (
        <Tabs.Panel id="ai"><section className="space-y-4 py-4">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <LockKeyhole className="size-4" aria-hidden="true" />
            AI 的判断
            <span className="text-xs text-muted">仅你可见</span>
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm">{myNote ?? "暂无判断"}</p>
          {table.persona && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">当前风格提示词</summary>
              <p className="mt-3 whitespace-pre-wrap break-words">{table.persona}</p>
            </details>
          )}
        </section></Tabs.Panel>
      )}
      </Tabs>
    </aside>
  )
}
