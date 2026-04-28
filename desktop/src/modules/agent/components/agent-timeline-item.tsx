import { AlertCircle } from "lucide-react"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"

function AgentTimelineItem({
  item,
  profile,
  onOpenReference,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly onOpenReference: (reference: string) => void
}) {
  switch (item.kind) {
    case "message":
      return <AgentMessageEvent item={item} onOpenReference={onOpenReference} />
    case "thinking":
      return <AgentThinkingEvent item={item} profile={profile} />
    case "toolCall":
    case "toolResult":
    case "permissionRequest":
      return <AgentToolEvent item={item} profile={profile} />
    case "error":
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription>{item.message}</AlertDescription>
        </Alert>
      )
    case "result":
      return null
    default: {
      const exhaustive: never = item
      return exhaustive
    }
  }
}

export { AgentTimelineItem }
