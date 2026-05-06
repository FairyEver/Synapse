import type { RefObject } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { AgentRunStatus } from "./agent-run-status"
import { AgentTimelineItem } from "./agent-timeline-item"

function AgentTimeline({
  items,
  profile,
  sending,
  onOpenReference,
  bottomRef,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly sending: boolean
  readonly onOpenReference: (reference: string) => void
  readonly bottomRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-0 px-0 pb-24 pt-2">
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
        ) : items.map((item) => (
          <AgentTimelineItem
            key={item.id}
            item={item}
            profile={profile}
            onOpenReference={onOpenReference}
          />
        ))}
        {sending ? <AgentRunStatus label={`${profile.agentLabel} 正在处理`} /> : null}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </ScrollArea>
  )
}

export { AgentTimeline }
