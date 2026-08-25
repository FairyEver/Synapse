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
      readonly lifecycle: ProcessGroupLifecycle
      readonly entries: readonly TimelineDisplayEntry[]
      readonly itemCount: number
      readonly summary: string
      readonly label: string
      readonly durationLabel?: string
      readonly state: ProcessGroupState
    }

export type ProcessGroupLifecycle = "active" | "completed"

export type ProcessGroupState = {
  readonly active: boolean
  readonly failed: boolean
  readonly denied: boolean
  readonly pendingPermission: boolean
}

export type GroupTimelineDisplayContext = {
  readonly pendingPermissionRequestIds: ReadonlySet<string>
  readonly nowMs?: number
  readonly sending?: boolean
}

export function groupTimelineDisplayEntries(
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext,
): readonly AgentTimelineDisplayNode[] {
  const nodes: AgentTimelineDisplayNode[] = []
  const turns = timelineTurns(entries)

  for (let index = 0; index < turns.length; index += 1) {
    appendTurnNodes(nodes, turns[index] ?? [], {
      ...context,
      lifecycle: context.sending === true && index === turns.length - 1 ? "active" : "completed",
    })
  }
  return nodes
}

function timelineTurns(entries: readonly TimelineDisplayEntry[]): readonly (readonly TimelineDisplayEntry[])[] {
  const turns: TimelineDisplayEntry[][] = []
  let current: TimelineDisplayEntry[] = []
  for (const entry of entries) {
    if (isUserMessage(entry) && current.length > 0) {
      turns.push(current)
      current = []
    }
    current.push(entry)
  }
  if (current.length > 0) turns.push(current)
  return turns
}

function appendTurnNodes(
  nodes: AgentTimelineDisplayNode[],
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext & { readonly lifecycle: ProcessGroupLifecycle },
): void {
  const first = entries[0]
  const hasUserAnchor = first ? isUserMessage(first) : false
  let anchorId = hasUserAnchor && first ? first.item.id : "root"
  let pendingProcessEntries: TimelineDisplayEntry[] = []
  const finalAssistantIndex = context.lifecycle === "completed" && !turnDidNotComplete(entries)
    ? findLastAssistantIndex(entries)
    : -1

  const flushProcessEntries = () => {
    if (pendingProcessEntries.length === 0) return
    nodes.push(createProcessGroup(pendingProcessEntries, anchorId, context))
    pendingProcessEntries = []
  }

  if (hasUserAnchor && first) {
    nodes.push({ kind: "item", entry: first })
  }

  for (let index = hasUserAnchor ? 1 : 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry || index === finalAssistantIndex) continue
    if (isRequiredMainlineEntry(entry, context)) {
      flushProcessEntries()
      nodes.push({ kind: "item", entry })
      anchorId = entry.item.id
      continue
    }
    pendingProcessEntries.push(entry)
  }

  flushProcessEntries()
  const finalAssistant = finalAssistantIndex >= 0 ? entries[finalAssistantIndex] : undefined
  if (finalAssistant) nodes.push({ kind: "item", entry: finalAssistant })
}

function isUserMessage(entry: TimelineDisplayEntry): boolean {
  return entry.item.kind === "message" && entry.item.role === "user"
}

function findLastAssistantIndex(entries: readonly TimelineDisplayEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index]?.item
    if (item?.kind === "message" && item.role === "assistant") return index
  }
  return -1
}

function turnDidNotComplete(entries: readonly TimelineDisplayEntry[]): boolean {
  return entries.some((entry) => {
    const item = entry.item
    if (item.kind === "error") {
      const status = item.turnOutcome?.status
      return status !== undefined ? status !== "completed" : !item.recoverable
    }
    if (item.kind !== "result") return false
    const status = item.metadata?.turnOutcome?.status
    return status !== undefined && status !== "completed"
  })
}

function isRequiredMainlineEntry(
  entry: TimelineDisplayEntry,
  context: GroupTimelineDisplayContext,
): boolean {
  const item = entry.item
  if (isUserMessage(entry)) return true
  if (item.kind === "permissionRequest" && context.pendingPermissionRequestIds.has(item.requestId)) return true
  if (item.kind === "error") {
    return !item.recoverable || (item.turnOutcome !== undefined && item.turnOutcome.status !== "completed")
  }
  if (item.kind === "result") {
    const status = item.metadata?.turnOutcome?.status
    return status === "cancelled" || status === "failed" || status === "timed_out" || status === "interrupted"
  }
  return false
}

function createProcessGroup(
  entries: readonly TimelineDisplayEntry[],
  anchorId: string,
  context: GroupTimelineDisplayContext & { readonly lifecycle: ProcessGroupLifecycle },
): AgentTimelineDisplayNode {
  const state = processGroupState(entries, context)
  const label = processGroupLabel(state)
  const durationLabel = processGroupDurationLabel(entries, state, context.nowMs)
  return {
    kind: "processGroup",
    id: `process:${anchorId}`,
    lifecycle: context.lifecycle,
    entries,
    itemCount: entries.length,
    summary: processGroupSummary(label, durationLabel),
    label,
    ...(durationLabel ? { durationLabel } : {}),
    state,
  }
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

function processGroupState(
  entries: readonly TimelineDisplayEntry[],
  context: GroupTimelineDisplayContext & { readonly lifecycle: ProcessGroupLifecycle },
): ProcessGroupState {
  const active = context.lifecycle === "active"
  let failed = false
  let denied = false
  let pendingPermission = false

  for (const entry of entries) {
    const item = entry.item
    const result = entry.result ?? (item.kind === "toolResult" ? item : undefined)
    if (item.kind === "permissionRequest" && context.pendingPermissionRequestIds.has(item.requestId)) {
      pendingPermission = true
    }
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
): boolean {
  if (group.state.pendingPermission) return true
  if (group.state.active) return true
  return false
}
