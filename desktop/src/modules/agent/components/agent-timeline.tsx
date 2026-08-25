import { useState, type Ref } from "react"
import { Button } from "@/components/ui/button"
import type {
  SynapseAgentDisplayProfile,
  SynapseAgentPendingPermission,
  SynapseAgentPermissionScope,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { useActivePhaseTicker } from "../hooks/use-active-phase-ticker"
import type { AgentReferenceActions } from "../hooks/use-agent-reference-actions"
import { AgentPhaseRow } from "./agent-phase-row"
import { AgentProcessGroup } from "./agent-process-group"
import { AgentRunStatus } from "./agent-run-status"
import {
  defaultProcessGroupOpen,
  groupTimelineDisplayEntries,
  timelineDisplayEntries,
} from "./agent-timeline-display"
import { AgentTimelineItem } from "./agent-timeline-item"

function AgentTimeline({
  items,
  profile,
  agentIcon,
  sending,
  pendingPermissions,
  onOpenReference,
  referenceActions,
  onRespondPermission,
  viewportRef,
  loadingOlder,
  historyError,
  onRetryHistory,
}: {
  readonly items: readonly SynapseAgentTimelineItem[]
  readonly profile: SynapseAgentDisplayProfile
  readonly agentIcon?: string
  readonly sending: boolean
  readonly pendingPermissions: readonly SynapseAgentPendingPermission[]
  readonly onOpenReference: (reference: string) => void
  readonly referenceActions?: AgentReferenceActions
  readonly onRespondPermission: (
    requestId: string,
    behavior: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string,
    scope?: SynapseAgentPermissionScope,
  ) => void | Promise<void>
  readonly viewportRef: Ref<HTMLDivElement>
  readonly loadingOlder: boolean
  readonly historyError: string | null
  readonly onRetryHistory: () => void
}) {
  // Drives 1s re-renders for any in-progress phase row's elapsed timer.
  useActivePhaseTicker(items)
  const now = Date.now()
  const latestPendingItemIds = latestPendingTimelineItemIds(items, pendingPermissions)
  const pendingPermissionRequestIds = new Set(pendingPermissions.map((permission) => permission.requestId))
  const displayEntries = timelineDisplayEntries(items)
  const displayNodes = groupTimelineDisplayEntries(displayEntries, {
    pendingPermissionRequestIds,
    nowMs: now,
    sending,
  })
  const [processGroupOpenOverrides, setProcessGroupOpenOverrides] = useState<Record<string, boolean>>({})
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {displayNodes.length === 0 ? (
          <div data-allow-select="true" className="mx-auto flex min-h-full min-w-0 max-w-4xl items-center justify-center px-4 pb-34 pt-4 text-center">
            {sending ? (
              <AgentRunStatus label="Agent 正在启动" />
            ) : (
              <p className="text-sm text-muted-foreground">暂无消息</p>
            )}
          </div>
        ) : (
          <div data-allow-select="true" className="mx-auto flex min-w-0 max-w-4xl flex-col gap-2 px-4 pb-34 pt-4">
            {loadingOlder ? (
              <p className="py-2 text-center text-sm text-muted-foreground">加载中</p>
            ) : historyError ? (
              <div className="flex justify-center py-1">
                <Button type="button" variant="ghost" size="sm" onClick={onRetryHistory}>
                  重试加载
                </Button>
              </div>
            ) : null}
            {displayNodes.map((node) => {
              if (node.kind === "processGroup") {
                const overrideKey = `${node.id}:${node.lifecycle}`
                const open = processGroupOpenOverrides[overrideKey] ?? defaultProcessGroupOpen(node)
                return (
                  <AgentProcessGroup
                    key={node.id}
                    label={node.label}
                    durationLabel={node.durationLabel}
                    open={open}
                    onOpenChange={(nextOpen) =>
                      setProcessGroupOpenOverrides((current) => ({
                        ...current,
                        [overrideKey]: nextOpen,
                      }))}
                  >
                    {node.entries.map((entry) => (
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
                          referenceActions={referenceActions}
                          onRespondPermission={onRespondPermission}
                        />
                      )
                    ))}
                  </AgentProcessGroup>
                )
              }
              const entry = node.entry
              return entry.item.kind === "phase" ? (
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
                  referenceActions={referenceActions}
                  onRespondPermission={onRespondPermission}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
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
