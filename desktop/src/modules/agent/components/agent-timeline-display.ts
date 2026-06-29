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
      readonly label: string
      readonly durationLabel?: string
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
  readonly nowMs?: number
}

export function groupTimelineDisplayEntries(
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext,
): readonly AgentTimelineDisplayNode[] {
  const nodes: AgentTimelineDisplayNode[] = []
  let pendingProcessEntries: TimelineDisplayEntry[] = []

  const flushProcessEntries = () => {
    if (pendingProcessEntries.length === 0) return
    nodes.push(createProcessGroup(pendingProcessEntries, context.nowMs))
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

function createProcessGroup(entries: readonly TimelineDisplayEntry[], nowMs: number | undefined): AgentTimelineDisplayNode {
  const state = processGroupState(entries)
  const label = processGroupLabel(state)
  const durationLabel = processGroupDurationLabel(entries, state, nowMs)
  return {
    kind: "processGroup",
    id: processGroupId(entries),
    entries,
    itemCount: entries.length,
    summary: processGroupSummary(label, durationLabel),
    label,
    ...(durationLabel ? { durationLabel } : {}),
    state,
  }
}

function processGroupId(entries: readonly TimelineDisplayEntry[]): string {
  const first = entries[0]?.item.id ?? "empty"
  const last = entries[entries.length - 1]?.item.id ?? first
  return `process:${first}:${last}`
}

function processGroupLabel(state: ProcessGroupState): string {
  if (state.pendingPermission) return "等待处理"
  if (state.active) return "处理中"
  return "已处理"
}

function processGroupSummary(label: string, durationLabel: string | undefined): string {
  return durationLabel ? `${label} ${durationLabel}` : label
}

function processGroupDurationLabel(
  entries: readonly TimelineDisplayEntry[],
  state: ProcessGroupState,
  nowMs: number | undefined,
): string | undefined {
  const range = processGroupTimeRange(entries, state, nowMs)
  if (!range) return undefined
  return formatProcessGroupDuration(range.endMs - range.startMs)
}

function processGroupTimeRange(
  entries: readonly TimelineDisplayEntry[],
  state: ProcessGroupState,
  nowMs: number | undefined,
): { readonly startMs: number; readonly endMs: number } | undefined {
  let startMs: number | undefined
  let endMs: number | undefined

  for (const entry of entries) {
    const range = entryTimeRange(entry)
    if (!range) continue
    startMs = startMs === undefined ? range.startMs : Math.min(startMs, range.startMs)
    endMs = endMs === undefined ? range.endMs : Math.max(endMs, range.endMs)
  }

  if (startMs === undefined) return undefined
  if (state.active || state.pendingPermission) {
    const activeEndMs = Number.isFinite(nowMs) ? nowMs : undefined
    if (activeEndMs !== undefined) endMs = Math.max(endMs ?? startMs, activeEndMs)
  }
  if (endMs === undefined) return undefined
  return { startMs, endMs: Math.max(startMs, endMs) }
}

function entryTimeRange(entry: TimelineDisplayEntry): { readonly startMs: number; readonly endMs: number } | undefined {
  const itemRange = itemTimeRange(entry.item)
  const resultRange = entry.result ? itemTimeRange(entry.result) : undefined
  if (!itemRange) return resultRange
  if (!resultRange) return itemRange
  return {
    startMs: Math.min(itemRange.startMs, resultRange.startMs),
    endMs: Math.max(itemRange.endMs, resultRange.endMs),
  }
}

function itemTimeRange(item: SynapseAgentTimelineItem): { readonly startMs: number; readonly endMs: number } | undefined {
  if (item.kind === "phase") {
    const startMs = parseProcessTimestamp(item.startedAt)
    const endMs = parseProcessTimestamp(item.completedAt) ?? parseProcessTimestamp(item.timestamp)
    if (startMs === undefined && endMs === undefined) return undefined
    return {
      startMs: startMs ?? endMs ?? 0,
      endMs: endMs ?? startMs ?? 0,
    }
  }
  if (item.kind === "toolCall" || item.kind === "toolProgress") {
    const startMs = parseProcessTimestamp(item.startedAt) ?? parseProcessTimestamp(item.timestamp)
    const endMs = parseProcessTimestamp(item.timestamp)
    if (startMs === undefined && endMs === undefined) return undefined
    return {
      startMs: startMs ?? endMs ?? 0,
      endMs: endMs ?? startMs ?? 0,
    }
  }
  if (item.kind === "thinking") {
    const startMs = parseProcessTimestamp(item.startedAt) ?? parseProcessTimestamp(item.timestamp)
    const endMs = parseProcessTimestamp(item.timestamp)
    if (startMs === undefined && endMs === undefined) return undefined
    return {
      startMs: startMs ?? endMs ?? 0,
      endMs: endMs ?? startMs ?? 0,
    }
  }
  const timestampMs = parseProcessTimestamp(item.timestamp)
  if (timestampMs === undefined) return undefined
  return { startMs: timestampMs, endMs: timestampMs }
}

function parseProcessTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function formatProcessGroupDuration(durationMs: number): string | undefined {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (!Number.isFinite(totalSeconds)) return undefined
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
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

export function defaultProcessGroupOpen(
  group: Extract<AgentTimelineDisplayNode, { kind: "processGroup" }>,
  context: { readonly sending: boolean },
): boolean {
  if (group.state.pendingPermission) return true
  if (group.state.active) return true
  if (context.sending && group.state.active) return true
  return false
}
