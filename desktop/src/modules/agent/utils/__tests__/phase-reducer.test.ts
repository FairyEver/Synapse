import { describe, expect, it } from "vitest"
import type {
  SynapseAgentPhaseTimelineItem,
  SynapseAgentPhaseValue,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import { reducePhaseEvent } from "../phase-reducer"

const mkItem = (overrides: Partial<SynapseAgentPhaseTimelineItem>): SynapseAgentPhaseTimelineItem => ({
  id: overrides.id ?? "phase:default",
  kind: "phase",
  timestamp: overrides.timestamp ?? "2026-05-10T00:00:00.000Z",
  runId: overrides.runId ?? "run-1",
  phase: overrides.phase ?? "received",
  status: overrides.status ?? "in-progress",
  startedAt: overrides.startedAt ?? "2026-05-10T00:00:00.000Z",
  completedAt: overrides.completedAt,
  errorMessage: overrides.errorMessage,
})

const mkEvent = (overrides: {
  runId?: string
  phase: SynapseAgentPhaseValue
  status: "in-progress" | "done" | "failed"
  startedAt?: string
  completedAt?: string
  errorMessage?: string
  timestamp?: string
}) => ({
  runId: overrides.runId ?? "run-1",
  projectId: "p",
  sessionKey: "s",
  conversationId: "c",
  phase: overrides.phase,
  status: overrides.status,
  startedAt: overrides.startedAt ?? "2026-05-10T00:00:00.000Z",
  completedAt: overrides.completedAt,
  errorMessage: overrides.errorMessage,
  eventTimestamp: overrides.timestamp ?? "2026-05-10T00:00:00.500Z",
})

function findPhase(items: readonly SynapseAgentTimelineItem[], phase: SynapseAgentPhaseValue) {
  return items.find((item): item is SynapseAgentPhaseTimelineItem => item.kind === "phase" && item.phase === phase)
}

describe("reducePhaseEvent", () => {
  it("appends a new in-progress phase row", () => {
    const next = reducePhaseEvent([], mkEvent({ phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ kind: "phase", phase: "received", status: "in-progress" })
  })

  it("closes the matching in-progress row when a done event arrives", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.400Z" }),
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.400Z" })
  })

  it("auto-closes prior in-progress on the same runId when a new in-progress arrives", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "runtime_starting", status: "in-progress", timestamp: "2026-05-10T00:00:01.000Z" }),
    )
    expect(next).toHaveLength(2)
    expect(findPhase(next, "received")).toMatchObject({ status: "done", completedAt: "2026-05-10T00:00:01.000Z" })
    expect(findPhase(next, "runtime_starting")).toMatchObject({ status: "in-progress" })
  })

  it("treats runtime_ready as alias closer for runtime_starting", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "runtime_starting", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "runtime_ready", status: "done", timestamp: "2026-05-10T00:00:02.000Z" }),
    )
    expect(next).toHaveLength(1)
    expect(findPhase(next, "runtime_starting")).toMatchObject({
      status: "done",
      completedAt: "2026-05-10T00:00:02.000Z",
    })
    // runtime_ready itself does NOT add a row.
    expect(findPhase(next, "runtime_ready")).toBeUndefined()
  })

  it("treats completed as alias closer for all in-progress phases on the run", () => {
    const start: SynapseAgentTimelineItem[] = [
      mkItem({ id: "p1", phase: "streaming", status: "in-progress" }),
      mkItem({ id: "p2", phase: "request_submitted", status: "in-progress" }),
    ]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "completed", status: "done", timestamp: "2026-05-10T00:00:03.000Z" }),
    )
    expect(next.every((item: SynapseAgentTimelineItem) => item.kind === "phase" && item.status === "done")).toBe(true)
    // completed itself does NOT add a row.
    expect(findPhase(next, "completed")).toBeUndefined()
    expect(next).toHaveLength(2)
  })

  it("emits a failed terminal row and closes other in-progress phases as failed", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "runtime_starting", status: "in-progress" })]
    const next = reducePhaseEvent(
      start,
      mkEvent({ phase: "failed", status: "failed", errorMessage: "boom", timestamp: "2026-05-10T00:00:04.000Z" }),
    )
    expect(next).toHaveLength(2)
    expect(findPhase(next, "runtime_starting")).toMatchObject({ status: "failed", errorMessage: "boom" })
    expect(findPhase(next, "failed")).toMatchObject({ status: "failed", errorMessage: "boom" })
  })

  it("is idempotent on duplicate in-progress events", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(start, mkEvent({ phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "in-progress" })
  })

  it("does not affect items on a different runId", () => {
    const start: SynapseAgentTimelineItem[] = [mkItem({ id: "p1", runId: "run-A", phase: "received", status: "in-progress" })]
    const next = reducePhaseEvent(start, mkEvent({ runId: "run-B", phase: "received", status: "in-progress" }))
    expect(next).toHaveLength(2)
  })

  it("inserts closed item when done arrives without prior in-progress", () => {
    const next = reducePhaseEvent(
      [],
      mkEvent({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:05.000Z" }),
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ phase: "received", status: "done" })
  })
})
