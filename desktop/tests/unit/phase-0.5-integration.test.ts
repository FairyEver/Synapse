/**
 * Phase 0.5 — Integration test.
 *
 * SPEC §8 verification:
 *   - "open/close 幂等、跨 project 隔离、idle reaper 按时关闭、scope 正确注入"
 *   - "ProcessRuntime trivial 实现的 spawn/kill/status 正确"
 *
 * The bootstrap wiring is also exercised end-to-end.
 */

import { describe, expect, it } from "vitest"
import { createServiceRegistry } from "../../electron/runtime/service-registry"
import { createEventBus } from "../../electron/runtime/event-bus"
import { createDataRepository } from "../../electron/runtime/data-repo"
import {
  IdleReaper,
  createProjectContainerRegistry,
  type ProjectScopedService,
} from "../../electron/runtime/project-container"
import { createMainProcessRuntime } from "../../electron/runtime/process"
import { bootstrap } from "../../electron/runtime/runtime-mode"
import { createNoopLogger } from "../../electron/runtime/lib/test-helpers"

const noopLogger = createNoopLogger

describe("Phase 0.5 integration (T5.7)", () => {
  it("bootstrap('gui') returns a RuntimeContext with the registries provided", async () => {
    const registry = createServiceRegistry()
    const container = createProjectContainerRegistry({
      globalRegistry: registry,
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const ctx = await bootstrap("gui", { registry, container })
    expect(ctx.mode).toBe("gui")
    expect(ctx.registry).toBe(registry)
    expect(ctx.container).toBe(container)
  })

  it("bootstrap('headless') and bootstrap('cli') succeed (Phase 0 stubs)", async () => {
    const registry = createServiceRegistry()
    const container = createProjectContainerRegistry({
      globalRegistry: registry,
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    expect((await bootstrap("headless", { registry, container })).mode).toBe("headless")
    expect((await bootstrap("cli", { registry, container })).mode).toBe("cli")
  })

  it("ProjectContainer + ProcessRuntime cooperation: project-scoped service spawns a process", async () => {
    const eventBus = createEventBus({ defaultBackpressure: "drop-newest" })
    const dataRepo = createDataRepository()
    const registry = createServiceRegistry()
    const container = createProjectContainerRegistry({
      globalRegistry: registry,
      globalEventBus: eventBus,
      globalDataRepo: dataRepo,
      buildLogger: () => noopLogger(),
    })
    const runtime = createMainProcessRuntime()

    const agentService: ProjectScopedService<{ processId: string }> = {
      id: "agent.runtime",
      async create(ctx) {
        const handle = await runtime.spawn({
          id: `agent-${ctx.projectId}`,
          kind: "main",
          init: { projectId: ctx.projectId },
        })
        expect(handle.status).toBe("running")
        return { processId: `agent-${ctx.projectId}` }
      },
      async stop(_instance, _ctx) {
        // Process cleanup hook — main impl is a no-op.
      },
    }

    container.registerService(agentService)

    await container.open("p1")
    await container.open("p2")
    expect(runtime.list()).toHaveLength(2)

    await container.close("p1")
    expect(container.list().map((c) => c.projectId)).toEqual(["p2"])
  })

  it("idle reaper sweeps and bootstrap stays consistent", async () => {
    const registry = createServiceRegistry()
    const container = createProjectContainerRegistry({
      globalRegistry: registry,
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    let virtualNow = Date.now()
    const reaper = new IdleReaper(container, {
      idleTimeoutMs: 1000,
      checkIntervalMs: 999_999,
      now: () => virtualNow,
    })

    await container.open("p1")
    await container.open("p2")
    // Bring lastActive map up to date so the reaper has an explicit reading
    // rather than falling back to entry.openedAt (which uses real-time strings).
    reaper.markActive("p1")
    reaper.markActive("p2")
    virtualNow = virtualNow + 5000
    reaper.markActive("p1") // refresh p1 only
    await reaper.sweep()
    // p2 was idle and gets reaped; p1 stays.
    expect(container.list().map((c) => c.projectId)).toEqual(["p1"])
  })
})
