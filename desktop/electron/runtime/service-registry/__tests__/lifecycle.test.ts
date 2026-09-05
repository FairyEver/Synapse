import { describe, expect, it } from "vitest"
import {
  CircularDependencyError,
  FatalServiceFailureError,
  type ServiceDescriptor,
} from "../index"
import { createServiceRegistry } from "../registry"

interface Trace {
  events: string[]
  push(...parts: string[]): void
}
const makeTrace = (): Trace => {
  const events: string[] = []
  return {
    events,
    push(...parts) {
      events.push(parts.join(":"))
    },
  }
}

const tracingDescriptor = (
  trace: Trace,
  id: string,
  deps: string[] = [],
  overrides: Partial<ServiceDescriptor<{ id: string }>> = {},
): ServiceDescriptor<{ id: string }> => ({
  id,
  dependsOn: deps,
  criticality: "fatal",
  create() {
    trace.push("create", id)
    return { id }
  },
  start() {
    trace.push("start", id)
  },
  stop() {
    trace.push("stop", id)
  },
  ...overrides,
})

describe("ServiceRegistry.startAll lifecycle (T1.4)", () => {
  it("starts blocking services before background services", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "blocking"))
    registry.register(tracingDescriptor(trace, "background", [], {
      startupPhase: "background",
    }))

    await registry.startBlocking()
    expect(trace.events).toEqual(["create:blocking", "start:blocking"])
    expect(registry.inspect()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "blocking", status: "running", startupPhase: "blocking" }),
      expect.objectContaining({ id: "background", status: "pending", startupPhase: "background" }),
    ]))

    await registry.startBackground()
    expect(trace.events).toEqual([
      "create:blocking",
      "start:blocking",
      "create:background",
      "start:background",
    ])
  })

  it("creates and starts services in dependency order", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "c", ["b"]))
    registry.register(tracingDescriptor(trace, "b", ["a"]))
    registry.register(tracingDescriptor(trace, "a"))

    const result = await registry.startAll()
    expect(result.degraded).toEqual([])

    const created = trace.events.filter((e) => e.startsWith("create"))
    const started = trace.events.filter((e) => e.startsWith("start"))
    expect(created).toEqual(["create:a", "create:b", "create:c"])
    expect(started).toEqual(["start:a", "start:b", "start:c"])

    expect(registry.inspect().every((e) => e.status === "running")).toBe(true)
  })

  it("supports async create and start", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "fatal",
      async create() {
        await new Promise((r) => setTimeout(r, 1))
        return { ok: true }
      },
      async start() {
        await new Promise((r) => setTimeout(r, 1))
      },
    })
    await registry.startAll()
    expect(registry.get<{ ok: boolean }>("a").ok).toBe(true)
  })

  it("stops services in reverse dependency order", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "c", ["b"]))
    registry.register(tracingDescriptor(trace, "b", ["a"]))
    registry.register(tracingDescriptor(trace, "a"))

    await registry.startAll()
    trace.events.length = 0

    await registry.stopAll(15000)
    expect(trace.events).toEqual(["stop:c", "stop:b", "stop:a"])
    expect(registry.inspect().every((e) => e.status === "stopped")).toBe(true)
  })

  it("stops order-only consumers before their targets", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "consumer", [], {
      startAfter: ["target"],
    }))
    registry.register(tracingDescriptor(trace, "target"))

    await registry.startAll()
    expect(trace.events).toEqual([
      "create:target",
      "start:target",
      "create:consumer",
      "start:consumer",
    ])
    trace.events.length = 0

    await registry.stopAll(15000)
    expect(trace.events).toEqual(["stop:consumer", "stop:target"])
    expect(registry.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "target", status: "stopped" }),
        expect.objectContaining({ id: "consumer", status: "stopped" }),
      ]),
    )
  })

  it("fatal service failure aborts startAll and surfaces FatalServiceFailureError", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "broken",
      criticality: "fatal",
      create() {
        throw new Error("boom")
      },
    })
    registry.register({
      id: "downstream",
      criticality: "fatal",
      dependsOn: ["broken"],
      create: () => ({}),
    })

    await expect(registry.startAll()).rejects.toBeInstanceOf(FatalServiceFailureError)
    const inspected = registry.inspect()
    expect(inspected.find((e) => e.id === "broken")?.status).toBe("failed")
    expect(inspected.find((e) => e.id === "broken")?.lastError?.message).toBe("boom")
  })

  it("degraded service failures are collected and do not abort startAll", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "ok",
      criticality: "fatal",
      create: () => ({}),
    })
    registry.register({
      id: "soft-fail",
      criticality: "degraded",
      create() {
        throw new Error("expected soft failure")
      },
    })
    registry.register({
      id: "downstream",
      criticality: "degraded",
      dependsOn: ["soft-fail"],
      create: () => ({}),
    })

    const result = await registry.startAll()
    const ids = result.degraded.map((d) => d.id).sort()
    expect(ids).toEqual(["downstream", "soft-fail"])
    expect(result.degraded.find((d) => d.id === "soft-fail")?.error.message).toBe(
      "expected soft failure",
    )
    expect(registry.inspect().find((e) => e.id === "ok")?.status).toBe("running")
  })

  it("does not propagate an order-only dependency's degraded failure", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "consumer", [], {
      criticality: "degraded",
      startAfter: ["optional"],
    }))
    registry.register(tracingDescriptor(trace, "optional", [], {
      criticality: "degraded",
      create() {
        trace.push("create", "optional")
        throw new Error("optional unavailable")
      },
    }))

    const result = await registry.startAll()

    expect(trace.events).toEqual(["create:optional", "create:consumer", "start:consumer"])
    expect(result.degraded.map((failure) => failure.id)).toEqual(["optional"])
    expect(registry.inspect().find((entry) => entry.id === "consumer")?.status)
      .toBe("running")
  })

  it("does not propagate an order-only dependency skipped by a hard failure", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "consumer", [], {
      criticality: "degraded",
      startAfter: ["optional"],
    }))
    registry.register(tracingDescriptor(trace, "optional", ["broken"], {
      criticality: "degraded",
    }))
    registry.register(tracingDescriptor(trace, "broken", [], {
      criticality: "degraded",
      create() {
        trace.push("create", "broken")
        throw new Error("broken unavailable")
      },
    }))

    const result = await registry.startAll()

    expect(trace.events).toEqual(["create:broken", "create:consumer", "start:consumer"])
    expect(result.degraded.map((failure) => failure.id)).toEqual(["broken", "optional"])
    expect(registry.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "broken", status: "failed" }),
        expect.objectContaining({ id: "optional", status: "failed" }),
        expect.objectContaining({ id: "consumer", status: "running" }),
      ]),
    )
  })

  it("preserves hard failure propagation when an order-only edge is duplicated", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register(tracingDescriptor(trace, "consumer", ["dependency"], {
      criticality: "degraded",
      startAfter: ["dependency"],
    }))
    registry.register(tracingDescriptor(trace, "dependency", [], {
      criticality: "degraded",
      create() {
        trace.push("create", "dependency")
        throw new Error("dependency unavailable")
      },
    }))

    expect(registry.planStartOrder().map((descriptor) => descriptor.id)).toEqual([
      "dependency",
      "consumer",
    ])

    const result = await registry.startAll()

    expect(trace.events).toEqual(["create:dependency"])
    expect(result.degraded.map((failure) => failure.id)).toEqual([
      "dependency",
      "consumer",
    ])
    expect(registry.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "dependency", status: "failed" }),
        expect.objectContaining({ id: "consumer", status: "failed" }),
      ]),
    )
  })

  it("startAll throws on circular deps via planStartOrder", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "fatal",
      dependsOn: ["b"],
      create: () => ({}),
    })
    registry.register({
      id: "b",
      criticality: "fatal",
      dependsOn: ["a"],
      create: () => ({}),
    })
    await expect(registry.startAll()).rejects.toBeInstanceOf(CircularDependencyError)
  })

  it("registry is sealed after startAll begins", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "fatal",
      create: () => ({}),
    })
    await registry.startAll()
    expect(() =>
      registry.register({
        id: "b",
        criticality: "fatal",
        create: () => ({}),
      }),
    ).toThrow(/sealed/)
  })

  it("get() returns the instance after start", async () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "fatal",
      create: () => ({ value: 42 }),
    })
    await registry.startAll()
    expect(registry.get<{ value: number }>("a").value).toBe(42)
  })

  it("stopAll respects per-service timeout and continues with siblings", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry({ perServiceStopTimeoutMs: 50 })
    registry.register({
      id: "slow",
      criticality: "fatal",
      create: () => ({}),
      async stop() {
        trace.push("stop:slow:begin")
        // Never resolves — must time out.
        await new Promise(() => {})
      },
    })
    registry.register({
      id: "fast",
      criticality: "fatal",
      dependsOn: ["slow"],
      create: () => ({}),
      stop() {
        trace.push("stop:fast")
      },
    })
    await registry.startAll()
    await registry.stopAll(500)
    // "fast" stops first (reverse topo), "slow" times out next.
    expect(trace.events).toEqual(["stop:fast", "stop:slow:begin"])
    const inspected = registry.inspect()
    expect(inspected.find((e) => e.id === "fast")?.status).toBe("stopped")
    expect(inspected.find((e) => e.id === "slow")?.status).toBe("failed")
    expect(inspected.find((e) => e.id === "slow")?.lastError?.name).toBe(
      "ServiceStopTimeoutError",
    )
  })

  it("stopAll skips services that never started", async () => {
    const trace = makeTrace()
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "degraded",
      create() {
        throw new Error("nope")
      },
      stop() {
        trace.push("should-not-stop")
      },
    })
    await registry.startAll()
    await registry.stopAll(15000)
    expect(trace.events).toEqual([])
  })

  it("reload calls descriptor.reload only when the service is running", async () => {
    let reloaded = 0
    const registry = createServiceRegistry()
    registry.register({
      id: "a",
      criticality: "fatal",
      create: () => ({}),
      async reload() {
        reloaded++
      },
    })
    await registry.startAll()
    await registry.reload("a")
    await registry.reload("a")
    expect(reloaded).toBe(2)
  })
})
