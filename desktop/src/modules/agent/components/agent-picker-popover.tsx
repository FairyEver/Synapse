import { useState, type ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseAgentAvailability } from "@/types/agent"

type AgentPickerPopoverProps = {
  agents: SynapseAgentAvailability[]
  onSelect: (agentType: string) => void
  children: ReactNode
}

function AgentPickerPopover({ agents, onSelect, children }: AgentPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const available = agents.filter((agent) => agent.available)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-1">
        {available.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">无可用 Agent</p>
        ) : (
          <div className="flex flex-col">
            {available.map((agent) => {
              const def = agentDefinitions.find((d) => d.id === agent.agentType)
              return (
                <button
                  key={agent.agentType}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                  onClick={() => {
                    onSelect(agent.agentType)
                    setOpen(false)
                  }}
                >
                  {def?.icon ? (
                    <img src={def.icon} alt="" className="h-4 w-4 shrink-0" />
                  ) : null}
                  <span className="truncate">{agent.label}</span>
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export { AgentPickerPopover }
