import { describe, expect, it } from "vitest"
import { createRuntimeFixture } from "../fixtures/runtime"

/**
 * Phase 0.6 — Sample IPC integration test using the shared fixture.
 * Lives under `tests/ipc/` per SPEC §9 directory layout.
 */

describe("IPC fixture smoke test (T6.13)", () => {
  it("creates a runtime fixture with all components wired up", () => {
    const fixture = createRuntimeFixture()
    expect(fixture.serviceRegistry).toBeDefined()
    expect(fixture.eventBus).toBeDefined()
    expect(fixture.dataRepo).toBeDefined()
    expect(fixture.container).toBeDefined()
    expect(fixture.ipc).toBeDefined()
  })

  it("event emitted by one component reaches another via the shared EventBus", () => {
    const { eventBus } = createRuntimeFixture()
    const seen: string[] = []
    eventBus.on("repository", (e) => seen.push(e.type))
    eventBus.emit({
      domain: "repository",
      type: "updated",
      payload: {},
      timestamp: new Date().toISOString(),
    })
    eventBus.flushAllForTests()
    expect(seen).toEqual(["updated"])
  })
})
