import type {
  SynapseAgentSdkEventTimelineItem,
  SynapseAgentTimelineItem,
  SynapseAgentToolCallTimelineItem,
  SynapseAgentToolResultTimelineItem,
} from "@/types/agent"

export type TimelineDisplayEntry = {
  readonly item: SynapseAgentTimelineItem
  readonly result?: SynapseAgentToolResultTimelineItem
}

export function timelineDisplayEntries(items: readonly SynapseAgentTimelineItem[]): readonly TimelineDisplayEntry[] {
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

function isHiddenSdkStatus(item: SynapseAgentTimelineItem): item is SynapseAgentSdkEventTimelineItem {
  return item.kind === "sdkEvent" && item.sdkType === "status"
}

export type AgentTimelineDisplayNode =
  | { readonly kind: "item"; readonly entry: TimelineDisplayEntry }
  | {
      readonly kind: "processGroup"
      readonly id: string
      readonly entries: readonly TimelineDisplayEntry[]
      readonly itemCount: number
      readonly summary: string
      readonly state: ProcessGroupState
    }

export type ProcessGroupState = {
  readonly active: boolean
  readonly failed: boolean
  readonly denied: boolean
  readonly pendingPermission: boolean
}

export type GroupTimelineDisplayContext = {
  readonly pendingPermissionRequestIds: ReadonlySet<string>
}

export function groupTimelineDisplayEntries(
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext,
): readonly AgentTimelineDisplayNode[] {
  const nodes: AgentTimelineDisplayNode[] = []
  let pendingProcessEntries: TimelineDisplayEntry[] = []

  const flushProcessEntries = () => {
    if (pendingProcessEntries.length === 0) return
    nodes.push(createProcessGroup(pendingProcessEntries))
    pendingProcessEntries = []
  }

  for (const entry of entries) {
    if (isMainlineEntry(entry, context)) {
      flushProcessEntries()
      nodes.push({ kind: "item", entry })
      continue
    }
    pendingProcessEntries.push(entry)
  }

  flushProcessEntries()
  return nodes
}

function isMainlineEntry(
  entry: TimelineDisplayEntry,
  context: GroupTimelineDisplayContext,
): boolean {
  const item = entry.item
  if (item.kind === "message" && (item.role === "user" || item.role === "assistant")) return true
  if (item.kind === "permissionRequest" && context.pendingPermissionRequestIds.has(item.requestId)) return true
  if (item.kind === "error" && !item.recoverable) return true
  if (item.kind === "result") {
    const status = item.metadata?.turnOutcome?.status
    return status === "cancelled" || status === "failed" || status === "timed_out"
  }
  return false
}

function createProcessGroup(entries: readonly TimelineDisplayEntry[]): AgentTimelineDisplayNode {
  const state = processGroupState(entries)
  return {
    kind: "processGroup",
    id: processGroupId(entries),
    entries,
    itemCount: entries.length,
    summary: processGroupSummary(entries.length, state),
    state,
  }
}

function processGroupId(entries: readonly TimelineDisplayEntry[]): string {
  const first = entries[0]?.item.id ?? "empty"
  const last = entries[entries.length - 1]?.item.id ?? first
  return `process:${first}:${last}`
}

function processGroupSummary(itemCount: number, state: ProcessGroupState): string {
  if (state.pendingPermission) return "过程详情 · 等待权限"
  if (state.failed || state.denied) return "过程详情 · 1 个工具失败"
  return itemCount > 0 ? `过程详情 · ${itemCount} 项` : "过程详情"
}

function processGroupState(entries: readonly TimelineDisplayEntry[]): ProcessGroupState {
  let active = false
  let failed = false
  let denied = false
  let pendingPermission = false

  for (const entry of entries) {
    const item = entry.item
    const result = entry.result ?? (item.kind === "toolResult" ? item : undefined)
    if (item.kind === "toolCall" && !result) active = true
    if (item.kind === "toolProgress" && item.status === "preparing") active = true
    if (item.kind === "phase" && item.status === "in-progress") active = true
    if (item.kind === "permissionRequest") pendingPermission = true
    if (result) {
      if (isDeniedToolResult(result)) denied = true
      if (isFailedToolResult(result)) failed = true
    }
    if (item.kind === "phase" && item.status === "failed" && !item.recoverable) failed = true
    if (item.kind === "error") failed = true
  }

  return { active, failed, denied, pendingPermission }
}

function isDeniedToolResult(item: SynapseAgentToolResultTimelineItem): boolean {
  return item.status?.toLowerCase() === "denied"
}

function isFailedToolResult(item: SynapseAgentToolResultTimelineItem): boolean {
  if (item.success === false) return true
  if (typeof item.exitCode === "number" && item.exitCode !== 0) return true
  const status = item.status?.toLowerCase()
  return status === "failed" || status === "error" || status === "denied"
}
