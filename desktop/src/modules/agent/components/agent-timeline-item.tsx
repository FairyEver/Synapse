import { AlertCircle, Info } from "lucide-react"
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentPermissionScope,
  SynapseAgentTimelineItem,
  SynapseAgentToolProgressTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"
import { AgentMessageEvent } from "./agent-message-event"
import { AgentAnnotation } from "./agent-annotation"
import { AgentPermissionCard } from "./agent-permission-card"
import { AgentThinkingEvent } from "./agent-thinking-event"
import { AgentToolEvent } from "./agent-tool-event"
import { AgentUserQuestionCard } from "./agent-user-question-card"

function AgentTimelineItem({
  item,
  profile,
  agentIcon,
  pendingPermissions,
  latestPendingItemIds,
  onOpenReference,
  onRespondPermission,
  toolResult,
}: {
  readonly item: SynapseAgentTimelineItem
  readonly toolResult?: SynapseAgentToolResultTimelineItem
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly latestPendingItemIds?: ReadonlySet<string>
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => void | Promise<void>
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
      return <AgentToolEvent item={item} result={toolResult} profile={profile} />
    case "toolProgress":
      return <AgentToolProgressEvent item={item} />
    case "permissionRequest": {
      const hasPendingRequest = pendingPermissions.some((p) => p.requestId === item.requestId)
      const isPending = hasPendingRequest && (latestPendingItemIds?.has(item.id) ?? true)
      const isLatestPending =
        isPending && pendingPermissions[pendingPermissions.length - 1]?.requestId === item.requestId
      if (isAskUserQuestionItem(item)) {
        return (
          <AgentUserQuestionCard
            item={item}
            pending={isPending}
            isLatestPending={isLatestPending}
            onRespond={onRespondPermission}
          />
        )
      }
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
      if (item.recoverable) {
        return (
          <Alert>
            <Info data-icon="inline-start" />
            <AlertDescription className="whitespace-pre-wrap break-words">{item.message}</AlertDescription>
          </Alert>
        )
      }
      return (
        <Alert variant="destructive">
          <AlertCircle data-icon="inline-start" />
          <AlertDescription className="whitespace-pre-wrap break-words">{item.message}</AlertDescription>
        </Alert>
      )
    case "result": {
      const outcome = item.metadata?.turnOutcome
      if (outcome?.status === "cancelled") {
        return (
          <Alert>
            <Info data-icon="inline-start" />
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )
      }
      return null
    }
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
            <Badge variant="secondary" className="h-5 shrink-0 text-xs">
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

function AgentToolProgressEvent({ item }: { readonly item: SynapseAgentToolProgressTimelineItem }) {
  const size = formatInputSize(item.inputCharCount)
  return (
    <AgentAnnotation>
      <div className="flex min-w-0 items-center gap-2 px-0 py-1 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <span className="truncate">
          {item.status === "stopped" ? "已停止，工具未执行" : `正在准备 ${item.toolName}`}
        </span>
        {item.status === "preparing" && size ? (
          <Badge variant="secondary" className="h-5 shrink-0 text-xs">
            {size}
          </Badge>
        ) : null}
      </div>
    </AgentAnnotation>
  )
}

function formatInputSize(chars: number): string | undefined {
  if (chars <= 0) return undefined
  if (chars < 1024) return `${chars} B`
  const kb = chars / 1024
  if (kb < 1024) return `${formatSizeNumber(kb)} KB`
  return `${formatSizeNumber(kb / 1024)} MB`
}

function formatSizeNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function isAskUserQuestionItem(item: SynapseAgentTimelineItem): boolean {
  return item.kind === "permissionRequest" && item.toolName === "AskUserQuestion"
}

export { AgentTimelineItem }
