import type { Ref } from "react"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { useActivePhaseTicker } from "../hooks/use-active-phase-ticker"
import { AgentPhaseRow } from "./agent-phase-row"
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
  viewportRef,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly onRespondPermission: (requestId: string, behavior: "allow" | "deny") => void | Promise<void>
  readonly viewportRef: Ref<HTMLDivElement>
}) {
  // Drives 1s re-renders for any in-progress phase row's elapsed timer.
  useActivePhaseTicker(items)
  const now = Date.now()
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 pr-4 pb-34 pt-4">
          {items.length === 0 ? (
            sending ? (
              <AgentRunStatus label="Agent 正在启动" />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
            )
          ) : items.map((item) => (
            item.kind === "phase" ? (
              <AgentPhaseRow key={item.id} item={item} now={now} />
            ) : (
              <AgentTimelineItem
                key={item.id}
                item={item}
                profile={profile}
                agentIcon={agentIcon}
                pendingPermissions={pendingPermissions}
                onOpenReference={onOpenReference}
                onRespondPermission={onRespondPermission}
              />
            )
          ))}
        </div>
      </div>
    </div>
  )
}

export { AgentTimeline }
