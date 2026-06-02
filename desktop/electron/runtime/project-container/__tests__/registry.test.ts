import { describe, expect, it, vi } from "vitest"
import {
  IdleReaper,
  createProjectContainerRegistry,
  type ProjectScopedService,
} from "../index"
import { createEventBus } from "../../event-bus"
import { createDataRepository } from "../../data-repo"
import { createServiceRegistry } from "../../service-registry"
import { createNoopLogger } from "../../lib/test-helpers"

const noopLogger = createNoopLogger

describe("ProjectContainerRegistry (T5.1 + T5.2)", () => {
  it("opens a container with no scoped services and emits project.activated", async () => {
    const eventBus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: Array<{ type: string; projectId?: string }> = []
    eventBus.on("project", (e) =>
      seen.push({ type: e.type, projectId: e.scope?.projectId }),
    )

    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: eventBus,
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const container = await reg.open("p1", { name: "Demo" })
    eventBus.flushAllForTests()
    expect(container.projectId).toBe("p1")
    expect(reg.list()).toHaveLength(1)
    expect(seen).toEqual([{ type: "activated", projectId: "p1" }])
  })

  it("open() twice returns the same container instance (idempotent)", async () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const a = await reg.open("p1")
    const b = await reg.open("p1")
    expect(a).toBe(b)
  })

  it("coalesces concurrent open() calls for the same project", async () => {
    let releaseStart: (() => void) | undefined
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    const created: object[] = []
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    reg.registerService({
      id: "slow",
      create() {
        const instance = {}
        created.push(instance)
        return instance
      },
      start: () => startGate,
    })

    const first = reg.open("p1")
    const second = reg.open("p1")

    await Promise.resolve()
    expect(created).toHaveLength(1)
    releaseStart?.()
    const [a, b] = await Promise.all([first, second])

    expect(a).toBe(b)
    expect(reg.list()).toHaveLength(1)
  })

  it("clears pending open state after start failure so the project can retry", async () => {
    let attempts = 0
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    reg.registerService({
      id: "flaky",
      create() {
        attempts += 1
        if (attempts === 1) throw new Error("start failed")
        return { ok: true }
      },
    })

    await expect(reg.open("p1")).rejects.toThrow("start failed")
    const container = await reg.open("p1")

    expect(container.projectId).toBe("p1")
    expect(attempts).toBe(2)
    expect(reg.list()).toHaveLength(1)
  })

  it("scoped services get the projectId-aware ScopedEventBus", async () => {
    const eventBus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: string[] = []
    eventBus.on("agent", (e) => seen.push(`${e.type}@${e.scope?.projectId ?? ""}`))

    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: eventBus,
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const echoService: ProjectScopedService<{ ok: true }> = {
      id: "agent.echo",
      create(ctx) {
        ctx.eventBus.emit({
          domain: "agent",
          type: "session.started",
          payload: {},
          timestamp: new Date().toISOString(),
        })
        return { ok: true }
      },
    }
    reg.registerService(echoService)
    await reg.open("p1")
    await reg.open("p2")
    eventBus.flushAllForTests()
    expect(seen.sort()).toEqual(["session.started@p1", "session.started@p2"])
  })

  it("dispose closes services in reverse dependency order", async () => {
    const trace: string[] = []
    const dep: ProjectScopedService = {
      id: "dep",
      create() {
        trace.push("create:dep")
        return {}
      },
      stop() {
        trace.push("stop:dep")
      },
    }
    const main: ProjectScopedService = {
      id: "main",
      dependsOn: ["dep"],
      create() {
        trace.push("create:main")
        return {}
      },
      stop() {
        trace.push("stop:main")
      },
    }
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    reg.registerService(dep)
    reg.registerService(main)
    await reg.open("p1")
    expect(trace).toEqual(["create:dep", "create:main"])
    trace.length = 0
    await reg.close("p1")
    expect(trace).toEqual(["stop:main", "stop:dep"])
  })

  it("keeps the container registered when service disposal fails", async () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    reg.registerService({
      id: "unstoppable",
      create: () => ({ alive: true }),
      stop: () => {
        throw new Error("stop failed")
      },
    })

    const container = await reg.open("p1")

    await expect(reg.close("p1")).rejects.toThrow("1 project service(s) failed to stop: unstoppable")
    expect(reg.peek("p1")).toBe(container)
    expect(await reg.open("p1")).toBe(container)
    expect(reg.list()).toHaveLength(1)
    expect(container.inspect()).toEqual([{ id: "unstoppable", status: "failed" }])
  })

  it("two project containers stay isolated — one's services don't leak", async () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const counter: ProjectScopedService<{ count: number }> = {
      id: "counter",
      create: () => ({ count: 0 }),
    }
    reg.registerService(counter)
    const a = await reg.open("p1")
    const b = await reg.open("p2")
    const aInst = a.get<{ count: number }>("counter")
    const bInst = b.get<{ count: number }>("counter")
    expect(aInst).not.toBe(bInst)
    aInst.count = 42
    expect(bInst.count).toBe(0)
  })

  it("setQuota stores the quota for an open project", async () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    await reg.open("p1")
    reg.setQuota("p1", { maxConcurrentSessions: 5 })
    expect(reg.getQuota("p1")?.maxConcurrentSessions).toBe(5)
    expect(() => reg.setQuota("p2", {})).toThrow(/Cannot set quota for unopened/)
  })

  it("circular dependency throws", async () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    reg.registerService({ id: "a", dependsOn: ["b"], create: () => ({}) })
    reg.registerService({ id: "b", dependsOn: ["a"], create: () => ({}) })
    await expect(reg.open("p1")).rejects.toThrow(/Circular/)
  })

  it("registerService rejects duplicate ids", () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const tmpl: ProjectScopedService = { id: "x", create: () => ({}) }
    reg.registerService(tmpl)
    expect(() => reg.registerService(tmpl)).toThrow(/already registered/)
  })
})

describe("IdleReaper (T5.3)", () => {
  it("sweep closes containers idle past the timeout", async () => {
    let now = 1_000_000
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const reaper = new IdleReaper(reg, {
      idleTimeoutMs: 1000,
      checkIntervalMs: 999_999,
      now: () => now,
    })

    await reg.open("p1")
    reaper.markActive("p1")

    // Advance clock past the timeout.
    now += 5_000
    await reaper.sweep()
    expect(reg.list()).toEqual([])
  })

  it("active project is not reaped", async () => {
    let now = 1_000_000
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const reaper = new IdleReaper(reg, {
      idleTimeoutMs: 1000,
      checkIntervalMs: 999_999,
      now: () => now,
    })

    await reg.open("p1")
    now += 5_000
    reaper.markActive("p1")
    await reaper.sweep()
    expect(reg.list()).toHaveLength(1)
  })

  it("start/stop installs an interval timer", () => {
    const reg = createProjectContainerRegistry({
      globalRegistry: createServiceRegistry(),
      globalEventBus: createEventBus({ defaultBackpressure: "drop-newest" }),
      globalDataRepo: createDataRepository(),
      buildLogger: () => noopLogger(),
    })
    const reaper = new IdleReaper(reg, { checkIntervalMs: 10 })
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval")
    reaper.start()
    reaper.start() // idempotent
    expect(setIntervalSpy).toHaveBeenCalledOnce()
    reaper.stop()
    setIntervalSpy.mockRestore()
  })
})
