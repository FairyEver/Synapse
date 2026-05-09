import type { RefObject } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentRunStatus } from "./agent-run-status"
import { AgentTimelineItem } from "./agent-timeline-item"

function AgentTimeline({
  items,
  profile,
  agentIcon,
  sending,
  pendingPermissions,
  onOpenReference,
  onRespondPermission,
  bottomRef,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void
  readonly bottomRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-6 px-4 pb-24 pt-4">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
        ) : items.map((item) => (
          <AgentTimelineItem
            key={item.id}
            item={item}
            profile={profile}
            agentIcon={agentIcon}
            pendingPermissions={pendingPermissions}
            onOpenReference={onOpenReference}
            onRespondPermission={onRespondPermission}
          />
        ))}
        {sending ? <AgentRunStatus label={`${profile.agentLabel} 正在处理`} /> : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </ScrollArea>
  )
}

export { AgentTimeline }
