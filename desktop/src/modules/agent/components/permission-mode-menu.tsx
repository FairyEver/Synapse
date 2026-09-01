import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
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
import { Separator } from "@/components/ui/separator"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import { getPermissionModeCapability } from "../permission-mode-capability"
import {
  permissionModeDescriptions,
  permissionModeHelp,
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
    <DropdownMenu data-track="agent-permission-mode-menu">
      <DropdownMenuTrigger asChild>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("w-[340px]", contentClassName)} forceMount>
        {permissionModes.map((mode) => (
          <HoverCard key={mode} openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem
                data-mode={mode}
                className="items-start gap-2 py-2"
                onSelect={() => {
                  track({
                    component: "agent",
                    name: "agent-permission-mode-select",
                    action: "select",
                    eventKey: "agent.permission-mode.select",
                    metadata: {
                      boundary: "renderer.agent.permission-mode-select",
                      currentMode: selectedMode,
                      targetMode: mode,
                      capability: getPermissionModeCapability({
                        currentMode: selectedMode,
                        targetMode: mode,
                      }),
                      changed: mode !== selectedMode,
                    },
                  })
                  onSelect(mode)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{permissionModeLabels[mode]}</span>
                    {mode === selectedMode ? (
                      <span className="text-xs text-muted-foreground">当前</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {permissionModeDescriptions[mode]}
                  </span>
                </span>
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="left" align="center" className="w-80">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1 truncate font-medium">{permissionModeLabels[mode]}</div>
                  <PermissionModeRiskBadge mode={mode} />
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{mode}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{permissionModeHelp[mode].englishLabel}</div>
              </div>
              <Separator className="my-2" />
              <div className="space-y-2 text-sm">
                <PermissionModeHelpLine label="会发生什么" text={permissionModeDescriptions[mode]} />
                <PermissionModeHelpLine label="适合" text={permissionModeHelp[mode].bestFor} />
                <PermissionModeHelpLine label="风险" text={permissionModeHelp[mode].risk} />
              </div>
              {permissionModeHelp[mode].note ? (
                <p className="mt-2 text-xs text-muted-foreground">{permissionModeHelp[mode].note}</p>
              ) : null}
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

function PermissionModeRiskBadge({ mode }: { readonly mode: SynapseAgentPermissionMode }) {
  const riskLevel = permissionModeHelp[mode].riskLevel
  return (
    <Badge variant={riskLevel === "高风险" ? "destructive" : "secondary"}>
      {riskLevel}
    </Badge>
  )
}

function PermissionModeHelpLine({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">{text}</div>
    </div>
  )
}

export { AgentPermissionModeMenu }
