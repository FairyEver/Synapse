import type { MouseEvent, ReactNode, Ref } from "react"
import { ModuleSidebarRow } from "@/components/module-sidebar"

type AgentSidebarSessionRowProps = {
  readonly active: boolean
  readonly children: ReactNode
  readonly icon?: ReactNode
  readonly onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void
  readonly onSelect: () => void
  readonly rowRef?: Ref<HTMLDivElement>
  readonly trailing: ReactNode
  readonly trackValue: string
}

function AgentSidebarSessionRow({
  active,
  children,
  icon,
  onDoubleClick,
  onSelect,
  rowRef,
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
      rowRef={rowRef}
    >
      {children}
    </ModuleSidebarRow>
  )
}

export { AgentSidebarSessionRow }
