import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { extractLabel, track } from "@/lib/ui-tracking"

type AgentSidebarSessionRowProps = {
  readonly active: boolean
  readonly children: ReactNode
  readonly icon?: ReactNode
  readonly onDoubleClick?: () => void
  readonly onSelect: () => void
  readonly trailing: ReactNode
  readonly trackValue: string
}

function AgentSidebarSessionRow({
  active,
  children,
  icon,
  onDoubleClick,
  onSelect,
  trailing,
  trackValue,
}: AgentSidebarSessionRowProps) {
  function handleSelect(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    track({
      component: "module-sidebar-item",
      name: extractLabel(event.currentTarget) ?? "agent-session-select",
      action: "select",
      value: trackValue,
    })
    onSelect()
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button")) return
    onDoubleClick?.()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-track="agent-session-select"
      aria-current={active ? "page" : undefined}
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        handleSelect(event)
      }}
      className={cn(
        "group/item flex h-8 w-full min-w-0 items-center rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-normal">
        {icon}
        <span className="block min-w-0 flex-1 truncate">{children}</span>
      </span>
      <span className="ml-2 flex min-w-6 shrink-0 items-center justify-center">{trailing}</span>
    </div>
  )
}

export { AgentSidebarSessionRow }
