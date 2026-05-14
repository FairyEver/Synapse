import { AlertCircle, Info } from "lucide-react"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentAnnotation } from "./agent-annotation"
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
      const isLatestPending =
        pendingPermissions[pendingPermissions.length - 1]?.requestId === item.requestId
      return (
        <AgentPermissionCard
          item={item}
          pending={isPending}
          isLatestPending={isLatestPending}
          onRespond={onRespondPermission}
        />
      )
    }
    case "error":
      if (!item.message || item.message.trim().length === 0) return null
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription className="whitespace-pre-wrap break-words">{item.message}</AlertDescription>
        </Alert>
      )
    case "result":
      return null
    case "phase":
      // Phase rows render through AgentPhaseRow inside AgentTimeline; this
      // branch is unreachable in the current call path but keeps the switch
      // exhaustive without coupling AgentTimelineItem to phase rendering.
      return null
    case "sdkEvent":
      return (
        <AgentAnnotation>
          <div className="flex min-w-0 items-center gap-2 px-0 py-1 text-xs text-muted-foreground">
            <Info className="size-3.5 shrink-0" />
            <span className="shrink-0">{item.label}</span>
            <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
              {item.sdkType}
            </Badge>
            {item.sdkSubtype ? (
              <span className="truncate">{item.sdkSubtype}</span>
            ) : item.summary ? (
              <span className="truncate">{item.summary}</span>
            ) : null}
          </div>
        </AgentAnnotation>
      )
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

export { AgentTimelineItem }
