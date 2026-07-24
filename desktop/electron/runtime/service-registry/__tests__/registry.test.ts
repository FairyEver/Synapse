import { describe, expect, it, vi } from "vitest"
import {
  CircularDependencyError,
  DuplicateServiceError,
  ServiceNotFoundError,
  ServiceNotRunningError,
  type ServiceRegistry,
  UnknownDependencyError,
  type ServiceDescriptor,
} from "../index"
import { ServiceRegistryImpl, createServiceRegistry } from "../registry"

const fixtureDescriptor = (
  id: string,
  deps: string[] = [],
  overrides: Partial<ServiceDescriptor<{ id: string }>> = {},
): ServiceDescriptor<{ id: string }> => ({
  id,
  dependsOn: deps,
  criticality: "fatal",
  create: () => ({ id }),
  ...overrides,
})

describe("ServiceRegistry register/inspect (T1.3)", () => {
  it("register stores the descriptor and inspect reports it as pending", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    const entries = registry.inspect()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      id: "a",
      status: "pending",
      criticality: "fatal",
      dependsOn: [],
      startAfter: [],
      runIn: "main",
      lastError: undefined,
    })
  })

  it("preserves registration order in inspect", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("z"))
    registry.register(fixtureDescriptor("y"))
    registry.register(fixtureDescriptor("x"))
    expect(registry.inspect().map((e) => e.id)).toEqual(["z", "y", "x"])
  })

  it("rejects duplicate ids", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    expect(() => registry.register(fixtureDescriptor("a"))).toThrowError(DuplicateServiceError)
  })

  it("rejects empty / non-string ids", () => {
    const registry = createServiceRegistry()
    expect(() =>
      registry.register({
        id: "",
        criticality: "fatal",
        create: () => ({}),
      } as ServiceDescriptor<unknown>),
    ).toThrow(/required/)
  })

  it("has() reports presence, get() rejects unknown", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    expect(registry.has("a")).toBe(true)
    expect(registry.has("b")).toBe(false)
    expect(() => registry.get("b")).toThrowError(ServiceNotFoundError)
  })

  it("get() rejects services that are not running yet", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    try {
      registry.get("a")
      throw new Error("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceNotRunningError)
      const e = err as ServiceNotRunningError
      expect(e.serviceId).toBe("a")
      expect(e.currentStatus).toBe("pending")
    }
  })

  it("inspect() returns runIn from descriptor when set", () => {
    const registry = createServiceRegistry()
    registry.register({
      id: "agent",
      criticality: "degraded",
      runIn: "utility",
      create: () => ({}),
    })
    expect(registry.inspect()[0]?.runIn).toBe("utility")
  })

  it("planStartOrder() validates the graph and returns descriptors in dep order", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("c", ["b"]))
    registry.register(fixtureDescriptor("b", ["a"]))
    registry.register(fixtureDescriptor("a"))
    const order = registry.planStartOrder().map((d) => d.id)
    expect(order).toEqual(["a", "b", "c"])
  })

  it("planStartOrder() honors order-only dependencies", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("consumer", [], { startAfter: ["optional"] }))
    registry.register(fixtureDescriptor("optional"))
    expect(registry.planStartOrder().map((d) => d.id)).toEqual([
      "optional",
      "consumer",
    ])
  })

  it("planStartOrder() throws UnknownDependencyError for missing deps", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", ["ghost"]))
    expect(() => registry.planStartOrder()).toThrowError(UnknownDependencyError)
  })

  it("planStartOrder() rejects unknown order-only dependencies", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", [], { startAfter: ["ghost"] }))
    expect(() => registry.planStartOrder()).toThrowError(UnknownDependencyError)
  })

  it("planStartOrder() throws CircularDependencyError for cycles", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", ["b"]))
    registry.register(fixtureDescriptor("b", ["a"]))
    expect(() => registry.planStartOrder()).toThrowError(CircularDependencyError)
  })

  it("planStartOrder() detects cycles across hard and order-only dependencies", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", ["b"]))
    registry.register(fixtureDescriptor("b", [], { startAfter: ["a"] }))
    expect(() => registry.planStartOrder()).toThrowError(CircularDependencyError)
  })

  it("inspect() result is immutable in spirit (returns new array each call)", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    const first = registry.inspect()
    const second = registry.inspect()
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })
})

describe("ServiceRegistryImpl T1.4 stubs (still throw)", () => {
  it("startAll succeeds with empty registry (no services)", async () => {
    const registry: ServiceRegistryImpl = new ServiceRegistryImpl({
      contextProvider: (r) => ({
        logger: makeNullLogger(),
        dataRepo: {} as never,
        eventBus: {} as never,
        registry: r,
        metrics: {} as never,
        tracer: {} as never,
        permissionGuard: {} as never,
        auditSink: {} as never,
        processRuntime: {} as never,
      }),
    })
    const result = await registry.startAll()
    expect(result.degraded).toEqual([])
  })

  it("stopAll succeeds with empty registry", async () => {
    const registry = createServiceRegistry()
    await expect(registry.stopAll(15000)).resolves.toBeUndefined()
  })

  it("logs stop failures and continues stopping later services", async () => {
    const logger = makeSpyLogger()
    const registry = new ServiceRegistryImpl({
      contextProvider: (r) => makeContext(r, logger),
    })
    const stopped: string[] = []

    registry.register(
      fixtureDescriptor("later", [], {
        stop: () => {
          stopped.push("later")
        },
      }),
    )
    registry.register(
      fixtureDescriptor("failing", [], {
        stop: () => {
          throw new Error("stop failed with token=sk-secret-value")
        },
      }),
    )

    await registry.startAll()
    await registry.stopAll(15000)

    expect(stopped).toEqual(["later"])
    expect(registry.inspect()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "failing", status: "failed" }),
        expect.objectContaining({ id: "later", status: "stopped" }),
      ]),
    )
    expect(logger.error).toHaveBeenCalledWith(
      "ServiceRegistry stop failed.",
      expect.objectContaining({
        serviceId: "failing",
        errorName: "Error",
      }),
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("sk-secret-value")
  })

  it("still invokes later stop handlers after the global deadline is exhausted", async () => {
    const registry = new ServiceRegistryImpl({
      contextProvider: (r) => makeContext(r, makeNullLogger()),
      perServiceStopTimeoutMs: 1,
    })
    const stopped: string[] = []

    registry.register(
      fixtureDescriptor("later", [], {
        stop: () => {
          stopped.push("later")
        },
      }),
    )
    registry.register(
      fixtureDescriptor("slow", [], {
        stop: () => new Promise((resolve) => setTimeout(resolve, 20)),
      }),
    )

    await registry.startAll()
    await registry.stopAll(1)

    expect(stopped).toEqual(["later"])
  })

  it("reload throws when descriptor lacks reload()", async () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a"))
    await registry.startAll()
    await expect(registry.reload("a")).rejects.toThrow(/does not declare reload/)
  })
})

function makeNullLogger() {
  const noop = () => {}
  const l = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => l,
  }
  return l
}

function makeSpyLogger() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  }
  return logger
}

function makeContext(registry: ServiceRegistry, logger: ReturnType<typeof makeNullLogger>) {
  return {
    logger,
    dataRepo: {} as never,
    eventBus: {} as never,
    registry,
    metrics: {} as never,
    tracer: {} as never,
    permissionGuard: {} as never,
    auditSink: {} as never,
    processRuntime: {} as never,
  }
}
