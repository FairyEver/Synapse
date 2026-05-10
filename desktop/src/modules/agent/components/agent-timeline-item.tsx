import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentPermissionCard } from "./agent-permission-card"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"

function AgentTimelineItem({
  item,
  profile,
  agentIcon,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void
}) {
  switch (item.kind) {
    case "message":
      return (
        <AgentMessageEvent
          item={item}
          profile={profile}
          agentIcon={agentIcon}
          onOpenReference={onOpenReference}
        />
      )
    case "thinking":
      return <AgentThinkingEvent item={item} profile={profile} />
    case "toolCall":
    case "toolResult":
      return <AgentToolEvent item={item} profile={profile} />
    case "permissionRequest": {
      const isPending = pendingPermissions.some((p) => p.requestId === item.requestId)
      return (
        <AgentPermissionCard
          item={item}
          pending={isPending}
          onRespond={onRespondPermission}
        />
      )
    }
    case "error":
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription>{item.message}</AlertDescription>
        </Alert>
      )
    case "result":
      return null
    case "phase":
      // Phase rows render through AgentPhaseRow inside AgentTimeline; this
      // branch is unreachable in the current call path but keeps the switch
      // exhaustive without coupling AgentTimelineItem to phase rendering.
      return null
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

export { AgentTimelineItem }
