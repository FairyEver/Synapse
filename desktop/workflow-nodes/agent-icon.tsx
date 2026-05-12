import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { cn } from "@/lib/utils"

const AGENT_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

const agentMap = new Map(agentDefinitions.map((def) => [def.id, def]))

export function getAgentLabel(agentId: string): string {
  return agentMap.get(agentId)?.label ?? agentId
}

function getAgentIconSrc(agentId: string): string | undefined {
  return agentMap.get(agentId)?.icon
}

export function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  const iconSrc = getAgentIconSrc(agentId)

  if (!iconSrc) {
    return null
  }

  return (
    <img
      src={iconSrc}
      alt=""
      aria-hidden="true"
      className={cn("size-4 shrink-0 rounded-sm", className)}
      style={AGENT_ICON_CLIP_STYLE}
    />
  )
}
