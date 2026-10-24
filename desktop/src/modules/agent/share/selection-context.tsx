import { createContext, useContext, useRef, type ReactNode } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { SynapseAgentMessageTimelineItem } from "@/types/agent"

export type AgentShareSelection = {
  readonly active: boolean
  readonly indexes: ReadonlyMap<string, number>
  readonly selected: ReadonlySet<string>
  readonly onShare: (id: string) => void
  readonly onChoose: (id: string, range: boolean) => void
}
export const AgentShareSelectionContext = createContext<AgentShareSelection | null>(null)
export function useAgentShareSelection() { return useContext(AgentShareSelectionContext) }

export function ShareMessageFrame({ item, children }: { readonly item: SynapseAgentMessageTimelineItem; readonly children: ReactNode }) {
  const share = useAgentShareSelection()
  const index = share?.indexes.get(item.id)
  const active = share?.active === true
  const selectable = active && index !== undefined
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  return (
    <div
      data-share-message={item.id}
      className={active ? cn("relative min-w-0 [&_[data-streamdown=code-block-copy-button]]:hidden", selectable && "cursor-pointer") : "contents"}
      onPointerDownCapture={active ? (event) => {
        if (event.shiftKey && event.button === 0) event.preventDefault()
        dragged.current = false
        pointerStart.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
      } : undefined}
      onPointerUpCapture={active ? (event) => {
        const start = pointerStart.current
        dragged.current = !!start && (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4)
        pointerStart.current = null
      } : undefined}
      onPointerCancelCapture={active ? () => { pointerStart.current = null; dragged.current = false } : undefined}
      onClickCapture={active && share ? (event) => {
        if (event.target instanceof Element && event.target.closest("[data-share-selection-control]")) return
        event.preventDefault()
        event.stopPropagation()
        const selection = window.getSelection()
        const selectingText = selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)
        if (selectable && !dragged.current && (event.shiftKey || !selectingText)) {
          if (event.shiftKey) selection?.removeAllRanges()
          share.onChoose(item.id, event.shiftKey)
        }
        dragged.current = false
      } : undefined}
      onContextMenuCapture={active ? (event) => { event.preventDefault(); event.stopPropagation() } : undefined}
    >
      {selectable && share && (
        <div data-share-selection-control className={cn("absolute -left-14 flex size-10 items-center justify-center", item.role === "user" ? "top-2.5" : "top-0")}>
          <Checkbox
            className="after:-inset-3"
            aria-label={`选择第 ${index + 1} 条消息`}
            title="按住 Shift 连续选择"
            checked={share.selected.has(item.id)}
            onClick={(event) => {
              event.preventDefault(); event.stopPropagation()
              if (event.detail === 0 || !dragged.current) share.onChoose(item.id, event.shiftKey)
              dragged.current = false
            }}
          />
        </div>
      )}
      {children}
    </div>
  )
}
