import { LockKeyhole } from "lucide-react"
import { useState } from "react"
import { Tabs } from "@heroui/react"
import type { PokerTableView, PokerTableEvent } from "@synapse/shared/game-contracts"
import { MatchLog } from "./MatchLog"
import { MatchOverview } from "./MatchOverview"
import { streetLabel } from "../lib/view"

interface Props {
  events?: PokerTableEvent[]
  id?: string
  identityKey?: string
  table: PokerTableView
  perspective: "owner" | "public"
}
function MatchInformation({ table, perspective, id, events = [] }: Props) {
  const [tab, setTab] = useState("log")
  const canSeeAi = perspective === "owner" && table.mySeatNo !== null
  const myNote = canSeeAi ? [...table.recentActions].reverse().find(a => a.note)?.note : null
  const settlement = table.settlement?.handId === table.handId ? table.settlement : events.find(e => e.handId === table.handId && e.settlement)?.settlement
  return <aside id={id} className="flex h-full min-h-0 flex-col p-4 font-sans text-foreground scheme-light" aria-label="对局信息">
    <header className="mb-4 space-y-1 pr-12"><h2 className="text-lg font-semibold">对局信息</h2><p className="text-xs text-muted">第 {table.handNo} 手 · {table.status === "closed" ? "房间已解散" : streetLabel[table.street ?? ""] ?? "等待开局"}</p></header>
    <Tabs selectedKey={tab} onSelectionChange={key => setTab(String(key))} variant="secondary" className="flex min-h-0 w-full flex-1 flex-col">
      <Tabs.ListContainer className="shrink-0"><Tabs.List aria-label="对局信息">
        <Tabs.Tab id="log">日志<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="overview">总览<Tabs.Indicator /></Tabs.Tab>
        <Tabs.Tab id="ai">AI<Tabs.Indicator /></Tabs.Tab>
      </Tabs.List></Tabs.ListContainer>
      <Tabs.Panel id="log" className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><MatchLog table={table} /></Tabs.Panel>
      <Tabs.Panel id="overview" className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><MatchOverview table={table} perspective={perspective} settlement={settlement ?? undefined} /></Tabs.Panel>
      <Tabs.Panel id="ai" className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><section className="space-y-4 py-4 text-sm">
        {!canSeeAi ? <p className="text-muted">仅本人入座后可查看 AI 判断</p> : <>
          <h3 className="flex flex-wrap items-center gap-2 font-medium"><LockKeyhole className="size-4" aria-hidden="true" />AI 判断<span className="text-xs text-muted">仅你可见</span></h3>
          <p className="whitespace-pre-wrap wrap-anywhere">{myNote ?? "暂无判断"}</p>
          {table.persona && <details><summary className="cursor-pointer text-muted">当前风格提示词</summary><p className="mt-3 whitespace-pre-wrap wrap-anywhere">{table.persona}</p></details>}
        </>}
      </section></Tabs.Panel>
    </Tabs>
  </aside>
}
export function SidePanel(props: Props) {
  return <MatchInformation key={`${props.identityKey}:${props.table.roomCode}:${props.table.handId}:${props.perspective}:${props.table.mySeatNo}`} {...props} />
}
