import { ListOrdered, LockKeyhole } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { Settlement } from "./Settlement"
import { PersonaBadge } from "./PersonaBadge"
import { actionLabel, amount, streetLabel } from "../lib/view"
export function SidePanel({
  table,
  perspective,
  id,
  events = [],
  extras,
}: {
  events?: PokerTableEvent[]
  extras?: ReactNode
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
  const tab = (selectedTab === "ai" && !canSeeAi) || (selectedTab === "practice" && !extras) ? "log" : selectedTab
  return (
    <aside id={id} className="poker-side-panel" aria-label="日志和AI判断">
      <Tabs value={tab} onValueChange={setSelectedTab} className="poker-information-tabs">
        <TabsList variant="line" aria-label="牌局信息">
          <TabsTrigger value="log">日志</TabsTrigger>
          {perspective === "owner" && table.mySeatNo !== null && <TabsTrigger value="ai">AI 判断</TabsTrigger>}
          {extras && <TabsTrigger value="practice">陪练</TabsTrigger>}
        </TabsList>
        <TabsContent value="log">
      {recentResults.map(result => <Settlement key={result.handId} settlement={result} compact />)}
      <section className="poker-log">
        <h3>
          <ListOrdered aria-hidden="true" />
          日志
        </h3>
        {table.recentActions.length === 0 ? (
          <p className="poker-panel-empty">暂无行动</p>
        ) : (
          <ol className="poker-action-list">
            {table.recentActions.map((action) => {
              const displayName = action.displayName ?? `座位 ${action.seatNo + 1}`
              return (
                <li key={`${table.handId}:${action.seq}`}>
                  <span className="poker-action-seq">{String(action.seq).padStart(2, "0")}</span>
                  <span className="poker-action-player">
                    <span title={displayName}>{displayName}</span>
                    <small>
                      {streetLabel[action.street] ?? action.street}
                      {action.isAuto && " · 自动"}
                      {action.actionSource === "rules_bot" && " · 机器人"}
                      {action.actionSource === "human" && " · 真人操作"}
                    </small>
                    {perspective === "owner" && action.personaVersion && (
                      <PersonaBadge version={action.personaVersion} />
                    )}
                  </span>
                  <span className="poker-action-decision">
                    {actionLabel[action.action] ?? action.action}
                    {action.amount > 0 && <strong>{amount(action.amount)}</strong>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
        </TabsContent>
      {perspective === "owner" && table.mySeatNo !== null && (
        <TabsContent value="ai"><section className="poker-judgment">
          <h3>
            <LockKeyhole aria-hidden="true" />
            AI 的判断
            <span className="poker-private-label">仅你可见</span>
          </h3>
          <p className="poker-judgment-text">{myNote ?? "暂无判断"}</p>
          {table.persona && (
            <details>
              <summary>当前风格提示词</summary>
              <p>{table.persona}</p>
            </details>
          )}
        </section></TabsContent>
      )}
      {extras && <TabsContent value="practice" forceMount hidden={tab !== "practice"}>{extras}</TabsContent>}
      </Tabs>
    </aside>
  )
}
