import type { ReactNode } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import {
  permissionModeDescriptions,
  permissionModeLabels,
  permissionModes,
  providerAvailabilityNotes,
} from "../permission-mode-options"

type AgentPermissionModeMenuProps = {
  readonly selectedMode: SynapseAgentPermissionMode
  readonly trigger: ReactNode
  readonly align?: "start" | "center" | "end"
  readonly contentClassName?: string
  readonly onSelect: (mode: SynapseAgentPermissionMode) => void
}

function AgentPermissionModeMenu({
  selectedMode,
  trigger,
  align = "end",
  contentClassName,
  onSelect,
}: AgentPermissionModeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName} forceMount>
        {permissionModes.map((mode) => (
          <HoverCard key={mode} openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem
                data-mode={mode}
                onSelect={() => {
                  onSelect(mode)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{permissionModeLabels[mode]}</span>
                {mode === selectedMode ? (
                  <span className="text-xs text-muted-foreground">当前</span>
                ) : null}
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="left" align="center">
              <div className="font-medium">{mode}</div>
              <p className="mt-1 text-sm text-muted-foreground">{permissionModeDescriptions[mode]}</p>
              {providerAvailabilityNotes[mode] ? (
                <p className="mt-2 text-xs text-muted-foreground/70">{providerAvailabilityNotes[mode]}</p>
              ) : null}
            </HoverCardContent>
          </HoverCard>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AgentPermissionModeMenu }
