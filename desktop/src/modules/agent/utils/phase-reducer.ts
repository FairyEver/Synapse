import type {
  SynapseAgentPhaseStatus,
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
  SynapseAgentTimelineItem,
} from "@/types/agent"

export interface PhaseReducerEvent {
  readonly runId: string
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
  readonly phase: SynapseAgentPhaseValue
  readonly status: SynapseAgentPhaseStatus
  readonly startedAt: string
  readonly completedAt?: string
  readonly errorMessage?: string
  readonly errorKind?: SynapseAgentPhaseTimelineItem["errorKind"]
  readonly recoverable?: boolean
  readonly eventTimestamp: string
}

const ALIAS_CLOSERS: Partial<Record<SynapseAgentPhaseValue, SynapseAgentPhaseValue>> = {
  runtime_ready: "runtime_starting",
  // `completed` is handled separately because it closes ALL in-progress phases on the run.
}

function isPhaseItem(item: SynapseAgentTimelineItem): item is SynapseAgentPhaseTimelineItem {
  return item.kind === "phase"
}

function newPhaseId(runId: string, phase: SynapseAgentPhaseValue): string {
  return `phase:${runId}:${phase}`
}

function closeItem(
  item: SynapseAgentPhaseTimelineItem,
  status: SynapseAgentPhaseStatus,
  completedAt: string,
  errorMessage?: string,
  errorKind?: SynapseAgentPhaseTimelineItem["errorKind"],
  recoverable?: boolean,
): SynapseAgentPhaseTimelineItem {
  return {
    ...item,
    status,
    completedAt,
    errorMessage: errorMessage ?? item.errorMessage,
    errorKind: errorKind ?? item.errorKind,
    recoverable: recoverable ?? item.recoverable,
  }
}

function matchesTerminalScope(item: SynapseAgentPhaseTimelineItem, event: PhaseReducerEvent): boolean {
  return item.runId === event.runId
    || (item.phase === "cancel_pending" && Boolean(event.conversationId) && item.runId === event.conversationId)
}

export function reducePhaseEvent(
  current: readonly SynapseAgentTimelineItem[],
  event: PhaseReducerEvent,
): SynapseAgentTimelineItem[] {
  // 1. Alias closer: runtime_ready → close runtime_starting; do NOT add a row.
  const aliasFor = ALIAS_CLOSERS[event.phase]
  if (aliasFor) {
    return current.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.phase !== aliasFor) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage, event.errorKind, event.recoverable)
    })
  }

  // 2. completed: run-success terminal. Close ALL in-progress on this run, no row appended.
  if (event.phase === "completed") {
    return current.map((item) => {
      if (!isPhaseItem(item)) return item
      if (!matchesTerminalScope(item, event)) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage, event.errorKind, event.recoverable)
    })
  }

  // 3. cancelled: run-cancel terminal. Close all in-progress as done AND append a terminal row.
  if (event.phase === "cancelled") {
    const closed = current.map((item) => {
      if (!isPhaseItem(item)) return item
      if (!matchesTerminalScope(item, event)) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage, event.errorKind, event.recoverable)
    })
    const existingCancelledIndex = closed.findIndex(
      (item) =>
        isPhaseItem(item)
        && item.runId === event.runId
        && item.phase === "cancelled",
    )
    if (existingCancelledIndex >= 0) {
      const target = closed[existingCancelledIndex] as SynapseAgentPhaseTimelineItem
      closed[existingCancelledIndex] = {
        ...target,
        timestamp: event.eventTimestamp,
        status: event.status,
        completedAt: event.completedAt ?? event.eventTimestamp,
        errorMessage: event.errorMessage ?? target.errorMessage,
        errorKind: event.errorKind ?? target.errorKind,
        recoverable: event.recoverable ?? target.recoverable,
      }
      return closed
    }
    closed.push({
      id: newPhaseId(event.runId, "cancelled"),
      kind: "phase",
      timestamp: event.eventTimestamp,
      runId: event.runId,
      phase: "cancelled",
      status: event.status,
      startedAt: event.startedAt,
      completedAt: event.completedAt ?? event.eventTimestamp,
      errorMessage: event.errorMessage,
      errorKind: event.errorKind,
      recoverable: event.recoverable,
    })
    return closed
  }

  // 4. failed: run-failure terminal. Close all in-progress as failed AND append a terminal row.
  if (event.phase === "failed") {
    const closed = current.map((item) => {
      if (!isPhaseItem(item)) return item
      if (!matchesTerminalScope(item, event)) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, "failed", event.completedAt ?? event.eventTimestamp, event.errorMessage, event.errorKind, event.recoverable)
    })
    const existingFailedIndex = closed.findIndex(
      (item) =>
        isPhaseItem(item)
        && item.runId === event.runId
        && item.phase === "failed",
    )
    if (existingFailedIndex >= 0) {
      const target = closed[existingFailedIndex] as SynapseAgentPhaseTimelineItem
      closed[existingFailedIndex] = {
        ...target,
        timestamp: event.eventTimestamp,
        status: "failed",
        completedAt: event.completedAt ?? event.eventTimestamp,
        errorMessage: event.errorMessage ?? target.errorMessage,
        errorKind: event.errorKind ?? target.errorKind,
        recoverable: event.recoverable ?? target.recoverable,
      }
      return closed
    }
    closed.push({
      id: newPhaseId(event.runId, "failed"),
      kind: "phase",
      timestamp: event.eventTimestamp,
      runId: event.runId,
      phase: "failed",
      status: "failed",
      startedAt: event.startedAt,
      completedAt: event.completedAt ?? event.eventTimestamp,
      errorMessage: event.errorMessage,
      errorKind: event.errorKind,
      recoverable: event.recoverable,
    })
    return closed
  }

  // 5. Normal in-progress: idempotent if same (runId, phase) is already in-progress;
  //    otherwise close prior in-progress on the run + append the new one.
  if (event.status === "in-progress") {
    const duplicate = current.some(
      (item) =>
        isPhaseItem(item)
        && item.runId === event.runId
        && item.phase === event.phase
        && item.status === "in-progress",
    )
    if (duplicate) return [...current]

    const closed = current.map((item) => {
      if (!isPhaseItem(item)) return item
      if (item.runId !== event.runId) return item
      if (item.status !== "in-progress") return item
      return closeItem(item, "done", event.eventTimestamp)
    })
    closed.push({
      id: newPhaseId(event.runId, event.phase),
      kind: "phase",
      timestamp: event.eventTimestamp,
      runId: event.runId,
      phase: event.phase,
      status: "in-progress",
      startedAt: event.startedAt,
    })
    return closed
  }

  // 5. Normal done|failed for a non-terminal phase: mutate matching in-progress; else insert as closed.
  const items = [...current]
  const idx = items.findIndex(
    (item) =>
      isPhaseItem(item)
      && item.runId === event.runId
      && item.phase === event.phase
      && item.status === "in-progress",
  )
  if (idx >= 0) {
    const target = items[idx] as SynapseAgentPhaseTimelineItem
    items[idx] = closeItem(target, event.status, event.completedAt ?? event.eventTimestamp, event.errorMessage, event.errorKind, event.recoverable)
    return items
  }
  items.push({
    id: newPhaseId(event.runId, event.phase),
    kind: "phase",
    timestamp: event.eventTimestamp,
    runId: event.runId,
    phase: event.phase,
    status: event.status,
    startedAt: event.startedAt,
    completedAt: event.completedAt ?? event.eventTimestamp,
    errorMessage: event.errorMessage,
    errorKind: event.errorKind,
    recoverable: event.recoverable,
  })
  return items
}
