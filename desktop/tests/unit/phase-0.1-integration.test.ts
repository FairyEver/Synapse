/**
 * Phase 0.1 — Integration test: full ServiceRegistry lifecycle.
 *
 * SPEC §4 verification:
 *   - "启动 inspect 全 running"
 *   - "关闭 15s 内 stopped"
 *
 * We use the public ServiceRegistry contract directly with synthetic
 * descriptors (no electron / no SQLite) so this test is fast and runs in pure
 * node. The end-to-end electron lifecycle is exercised by manual smoke testing
 * (and Phase 0.6 E2E tests).
 */

import { describe, expect, it } from "vitest"
import {
  type ServiceDescriptor,
  createServiceRegistry,
} from "../../electron/runtime/service-registry"

const stage: string[] = []

const fakeDescriptor = (
  id: string,
  deps: string[] = [],
  criticality: "fatal" | "degraded" = "fatal",
): ServiceDescriptor<{ id: string }> => ({
  id,
  dependsOn: deps,
  criticality,
  async create() {
    await Promise.resolve()
    stage.push(`create:${id}`)
    return { id }
  },
  async start() {
    await Promise.resolve()
    stage.push(`start:${id}`)
  },
  async stop() {
    await Promise.resolve()
    stage.push(`stop:${id}`)
  },
})

describe("Phase 0.1 integration: 9-service lifecycle (T1.9)", () => {
  it("startAll → all running, then stopAll within 15s → all stopped", async () => {
    stage.length = 0
    const registry = createServiceRegistry()

    // SPEC §4 mapping table — synthetic descriptors with the same dependsOn
    // graph as the real bootstrap registry.
    registry.register(fakeDescriptor("core.logging", [], "fatal"))
    registry.register(fakeDescriptor("core.config", [], "fatal"))
    registry.register(fakeDescriptor("core.app-icon", [], "degraded"))
    registry.register(fakeDescriptor("core.database", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("core.update", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("repo.watch", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("repo.maintenance", ["repo.watch"], "degraded"))
    registry.register(fakeDescriptor("repo.pending-pushes", ["core.database"], "degraded"))
    registry.register(fakeDescriptor("ui.tray", ["core.app-icon"], "degraded"))

    const startResult = await registry.startAll()
    expect(startResult.degraded).toEqual([])

    const inspected = registry.inspect()
    expect(inspected).toHaveLength(9)
    for (const entry of inspected) {
      expect(entry.status, `${entry.id} should be running`).toBe("running")
    }

    // Topo sanity in stage trace: each dep is created before its dependent.
    const idx = (event: string) => stage.indexOf(event)
    expect(idx("create:core.config")).toBeLessThan(idx("create:core.database"))
    expect(idx("create:core.config")).toBeLessThan(idx("create:repo.watch"))
    expect(idx("create:repo.watch")).toBeLessThan(idx("create:repo.maintenance"))
    expect(idx("create:core.database")).toBeLessThan(idx("create:repo.pending-pushes"))
    expect(idx("create:core.app-icon")).toBeLessThan(idx("create:ui.tray"))

    // Stop within 15s deadline.
    const t0 = Date.now()
    await registry.stopAll(15_000)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(15_000)

    const afterStop = registry.inspect()
    for (const entry of afterStop) {
      expect(entry.status, `${entry.id} should be stopped`).toBe("stopped")
    }

    // Stop order is reverse-topo of start order.
    const stopIdx = (id: string) => stage.indexOf(`stop:${id}`)
    expect(stopIdx("repo.maintenance")).toBeLessThan(stopIdx("repo.watch"))
    expect(stopIdx("repo.watch")).toBeLessThan(stopIdx("core.config"))
    expect(stopIdx("ui.tray")).toBeLessThan(stopIdx("core.app-icon"))
    expect(stopIdx("repo.pending-pushes")).toBeLessThan(stopIdx("core.database"))
  })

  it("buildServiceRegistry-shaped graph plans without error (no cycles, no missing deps)", async () => {
    const registry = createServiceRegistry()
    registry.register(fakeDescriptor("core.logging", [], "fatal"))
    registry.register(fakeDescriptor("core.config", [], "fatal"))
    registry.register(fakeDescriptor("core.app-icon", [], "degraded"))
    registry.register(fakeDescriptor("core.database", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("core.update", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("repo.watch", ["core.config"], "degraded"))
    registry.register(fakeDescriptor("repo.maintenance", ["repo.watch"], "degraded"))
    registry.register(fakeDescriptor("repo.pending-pushes", ["core.database"], "degraded"))
    registry.register(fakeDescriptor("ui.tray", ["core.app-icon"], "degraded"))

    expect(() => registry.planStartOrder()).not.toThrow()
    const order = registry.planStartOrder().map((d) => d.id)
    expect(order).toHaveLength(9)
  })
})
