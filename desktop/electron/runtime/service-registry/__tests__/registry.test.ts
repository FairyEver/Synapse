import { describe, expect, it } from "vitest"
import {
  CircularDependencyError,
  DuplicateServiceError,
  ServiceNotFoundError,
  ServiceNotRunningError,
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

  it("planStartOrder() throws UnknownDependencyError for missing deps", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", ["ghost"]))
    expect(() => registry.planStartOrder()).toThrowError(UnknownDependencyError)
  })

  it("planStartOrder() throws CircularDependencyError for cycles", () => {
    const registry = createServiceRegistry()
    registry.register(fixtureDescriptor("a", ["b"]))
    registry.register(fixtureDescriptor("b", ["a"]))
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
  it("startAll throws not-implemented (placeholder until T1.4)", async () => {
    const registry = new ServiceRegistryImpl({
      contextProvider: () => {
        throw new Error("unused in this test")
      },
    })
    await expect(registry.startAll()).rejects.toThrow(/T1\.4/)
  })

  it("stopAll throws not-implemented (placeholder until T1.4)", async () => {
    const registry = createServiceRegistry()
    await expect(registry.stopAll(15000)).rejects.toThrow(/T1\.4/)
  })

  it("reload throws not-implemented (placeholder until T1.4)", async () => {
    const registry = createServiceRegistry()
    await expect(registry.reload("a")).rejects.toThrow(/T1\.4/)
  })
})
