import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { SynapseAgentPhaseTimelineItem } from "@/types/agent"
import { AgentPhaseRow } from "../agent-phase-row"

function mk(item: Partial<SynapseAgentPhaseTimelineItem>): SynapseAgentPhaseTimelineItem {
  return {
    id: item.id ?? "phase:test",
    kind: "phase",
    timestamp: item.timestamp ?? "2026-05-10T00:00:00.000Z",
    runId: item.runId ?? "run",
    phase: item.phase ?? "received",
    status: item.status ?? "in-progress",
    startedAt: item.startedAt ?? "2026-05-10T00:00:00.000Z",
    completedAt: item.completedAt,
    errorMessage: item.errorMessage,
  }
}

describe("AgentPhaseRow", () => {
  it("renders 已发送 for submitted done", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "submitted", status: "done", completedAt: "2026-05-10T00:00:00.400Z" })}
        now={Date.parse("2026-05-10T00:00:00.500Z")}
      />,
    )
    expect(html).toContain("已发送")
  })

  it("renders 已收到 for received done", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "received", status: "done", completedAt: "2026-05-10T00:00:00.005Z" })}
        now={Date.parse("2026-05-10T00:00:00.500Z")}
      />,
    )
    expect(html).toContain("已收到")
  })

  it("shows the error message on a failed row", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "failed", status: "failed", errorMessage: "CLI exited 1", completedAt: "2026-05-10T00:00:01.000Z" })}
        now={Date.parse("2026-05-10T00:00:02.000Z")}
      />,
    )
    expect(html).toContain("失败")
    expect(html).toContain("CLI exited 1")
  })

  it("uses the destructive token color on failed", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "failed", status: "failed", errorMessage: "x", completedAt: "2026-05-10T00:00:01.000Z" })}
        now={Date.parse("2026-05-10T00:00:02.000Z")}
      />,
    )
    expect(html).toContain("text-destructive")
  })

  it("computes elapsed seconds for in-progress with one decimal", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({ phase: "runtime_starting", status: "in-progress" })}
        now={Date.parse("2026-05-10T00:00:01.250Z")}
      />,
    )
    // 1.25s -> "1.3s" via toFixed(1) banker's-rounding-equivalent
    expect(html).toMatch(/1\.[23]s/)
  })

  it("renders 0.0s when startedAt equals completedAt", () => {
    const html = renderToStaticMarkup(
      <AgentPhaseRow
        item={mk({
          phase: "received",
          status: "done",
          startedAt: "2026-05-10T00:00:00.000Z",
          completedAt: "2026-05-10T00:00:00.000Z",
        })}
        now={Date.parse("2026-05-10T00:00:00.500Z")}
      />,
    )
    expect(html).toContain("0.0s")
  })
})
