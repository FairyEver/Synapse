import type { Ref } from "react"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
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
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
  ) => void | Promise<void>
  readonly viewportRef: Ref<HTMLDivElement>
}) {
  // Drives 1s re-renders for any in-progress phase row's elapsed timer.
  useActivePhaseTicker(items)
  const now = Date.now()
  const latestPendingItemIds = latestPendingTimelineItemIds(items, pendingPermissions)
  const displayEntries = timelineDisplayEntries(items)
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 pr-4 pb-34 pt-4">
          {displayEntries.length === 0 ? (
            sending ? (
              <AgentRunStatus label="Agent 正在启动" />
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">暂无消息</p>
            )
          ) : displayEntries.map((entry) => (
            entry.item.kind === "phase" ? (
              <AgentPhaseRow key={entry.item.id} item={entry.item} now={now} />
            ) : (
              <AgentTimelineItem
                key={entry.item.id}
                item={entry.item}
                {...(entry.result ? { toolResult: entry.result } : {})}
                profile={profile}
                agentIcon={agentIcon}
                pendingPermissions={pendingPermissions}
                latestPendingItemIds={latestPendingItemIds}
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

type TimelineDisplayEntry = {
  readonly item: SynapseAgentTimelineItem
  readonly result?: SynapseAgentToolResultTimelineItem
}

function timelineDisplayEntries(items: readonly SynapseAgentTimelineItem[]): readonly TimelineDisplayEntry[] {
  const resultByUseId = new Map<string, SynapseAgentToolResultTimelineItem>()
  const toolCallUseIds = new Set<string>()
  for (const item of items) {
    if (item.kind === "toolCall" && item.toolUseId) {
      toolCallUseIds.add(item.toolUseId)
    }
    if (item.kind === "toolResult" && item.toolUseId && !resultByUseId.has(item.toolUseId)) {
      resultByUseId.set(item.toolUseId, item)
    }
  }

  const entries: TimelineDisplayEntry[] = []
  for (const item of items) {
    if (isHiddenSdkStatus(item)) continue
    if (item.kind === "toolCall") {
      const result = item.toolUseId ? resultByUseId.get(item.toolUseId) : undefined
      entries.push(result ? { item, result } : { item })
      continue
    }
    if (item.kind === "toolResult") {
      if (item.toolUseId && toolCallUseIds.has(item.toolUseId)) continue
      if (!item.toolUseId && attachLegacyToolResult(entries, item)) continue
    }
    entries.push({ item })
  }
  return entries
}

function attachLegacyToolResult(
  entries: TimelineDisplayEntry[],
  result: SynapseAgentToolResultTimelineItem,
): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry || entry.result || !isUnidentifiedToolCall(entry.item)) continue
    if (entry.item.toolName !== result.toolName) continue
    entries[index] = { item: entry.item, result }
    return true
  }
  return false
}

function isUnidentifiedToolCall(item: SynapseAgentTimelineItem): item is SynapseAgentToolCallTimelineItem {
  return item.kind === "toolCall" && !item.toolUseId
}

function isHiddenSdkStatus(item: SynapseAgentTimelineItem): boolean {
  return item.kind === "sdkEvent" && item.sdkType === "status"
}

function latestPendingTimelineItemIds(
  items: readonly SynapseAgentTimelineItem[],
  pendingPermissions: readonly SynapseAgentPendingPermission[],
): ReadonlySet<string> {
  const pendingRequestIds = new Set(pendingPermissions.map((permission) => permission.requestId))
  const latestItemIds = new Set<string>()
  const seenRequestIds = new Set<string>()
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "permissionRequest") continue
    if (!pendingRequestIds.has(item.requestId) || seenRequestIds.has(item.requestId)) continue
    seenRequestIds.add(item.requestId)
    latestItemIds.add(item.id)
  }
  return latestItemIds
}

export { AgentTimeline }
