import type { ReactNode } from "react"
import { ModuleSidebarRow } from "@/components/module-sidebar"

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
  return (
    <ModuleSidebarRow
      active={active}
      data-track="agent-session-select"
      icon={icon}
      trailing={trailing}
      trackValue={trackValue}
      onSelect={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </ModuleSidebarRow>
  )
}

export { AgentSidebarSessionRow }
