import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SynapseAgentTimelineItem } from "@/types/agent"
import { useActivePhaseTicker } from "../use-active-phase-ticker"

function asPhase(status: "in-progress" | "done"): SynapseAgentTimelineItem {
  return {
    id: `phase:${status}`,
    kind: "phase",
    timestamp: "2026-05-10T00:00:00.000Z",
    runId: "run",
    phase: "received",
    status,
    startedAt: "2026-05-10T00:00:00.000Z",
  }
}

function Driver({ items }: { items: SynapseAgentTimelineItem[] }) {
  const tick = useActivePhaseTicker(items)
  return <span data-tick={tick} />
}

describe("useActivePhaseTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // SSR exercises the render path only — the interval side effect runs in
  // useEffect which is not invoked by renderToStaticMarkup. These cases guard
  // against accidental render-time throws and an incorrect initial tick value.
  it("renders without error when there are no phase items", () => {
    const html = renderToStaticMarkup(<Driver items={[]} />)
    expect(html).toContain("data-tick=\"0\"")
  })

  it("renders without error when items are present", () => {
    const html = renderToStaticMarkup(<Driver items={[asPhase("in-progress")]} />)
    expect(html).toContain("data-tick=\"0\"")
  })

  it("renders without error for done items", () => {
    const html = renderToStaticMarkup(<Driver items={[asPhase("done")]} />)
    expect(html).toContain("data-tick=\"0\"")
  })
})
