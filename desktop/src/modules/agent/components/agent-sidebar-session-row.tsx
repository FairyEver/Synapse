import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { extractLabel, track } from "@/lib/ui-tracking"

type AgentSidebarSessionRowProps = {
  readonly active: boolean
  readonly children: ReactNode
  readonly icon?: ReactNode
  readonly onSelect: () => void
  readonly trailing: ReactNode
  readonly trackValue: string
}

function AgentSidebarSessionRow({
  active,
  children,
  icon,
  onSelect,
  trailing,
  trackValue,
}: AgentSidebarSessionRowProps) {
  return (
    <div
      data-track="agent-session-select"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/item flex h-8 w-full min-w-0 items-center rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-within:ring-3 focus-within:ring-inset focus-within:ring-ring/50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
      )}
    >
      <button
        type="button"
        data-track="agent-session-select"
        onClick={(event) => {
          track({
            component: "module-sidebar-item",
            name: extractLabel(event.currentTarget) ?? "agent-session-select",
            action: "select",
            value: trackValue,
          })
          onSelect()
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-xs font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {icon}
        <span className="block min-w-0 flex-1 truncate">{children}</span>
      </button>
      <span className="ml-2 flex shrink-0 items-center">{trailing}</span>
    </div>
  )
}

export { AgentSidebarSessionRow }
