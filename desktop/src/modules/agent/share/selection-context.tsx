import { createContext, useContext, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

export type AgentShareSelection = {
  readonly active: boolean
  readonly indexes: ReadonlyMap<string, number>
  readonly rounds: ReadonlyMap<string, readonly string[]>
  readonly selected: ReadonlySet<string>
  readonly onShare: (id: string) => void
  readonly onChoose: (id: string, range: boolean) => void
  readonly onRound: (ids: readonly string[]) => void
}
export const AgentShareSelectionContext = createContext<AgentShareSelection | null>(null)
export function useAgentShareSelection() { return useContext(AgentShareSelectionContext) }

export function ShareMessageFrame({ item, children }: { readonly item: SynapseAgentMessageTimelineItem; readonly children: ReactNode }) {
  const share = useAgentShareSelection()
  const index = share?.indexes.get(item.id)
  const selectable = share?.active && index !== undefined
  const round = selectable ? share.rounds.get(item.id) : undefined
  return <div data-share-message={item.id} className={cn(selectable ? "relative min-w-0 rounded-lg pl-8" : "contents", selectable && share.selected.has(item.id) && "bg-muted/50")}>
    {round && share && <div className="flex h-7 items-center justify-end"><Button type="button" variant="ghost" size="xs" onClick={() => share.onRound(round)}>{round.every((id) => share.selected.has(id)) ? "取消本轮" : "选择本轮"}</Button></div>}
    {selectable && share && <Checkbox className={cn("absolute left-1", round ? "top-11" : "top-4")} aria-label={`选择第 ${index + 1} 条消息`} checked={share.selected.has(item.id)} onClick={(event) => { event.preventDefault(); share.onChoose(item.id, event.shiftKey) }} />}
    {children}
  </div>
}
