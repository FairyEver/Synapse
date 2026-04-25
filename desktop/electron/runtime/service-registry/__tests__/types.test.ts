import { describe, expect, it } from "vitest"
import {
  CircularDependencyError,
  DuplicateServiceError,
  FatalServiceFailureError,
  ServiceNotFoundError,
  ServiceNotRunningError,
  ServiceRegistryError,
  ServiceStopTimeoutError,
  UnknownDependencyError,
  type ServiceDescriptor,
} from "../index"

describe("service-registry skeleton (T1.1)", () => {
  it("exports the canonical error hierarchy with the expected names", () => {
    const cases: Array<[Error, string]> = [
      [new ServiceRegistryError("x"), "ServiceRegistryError"],
      [new CircularDependencyError(["a", "b", "a"]), "CircularDependencyError"],
      [new UnknownDependencyError("svc", "missing"), "UnknownDependencyError"],
      [new DuplicateServiceError("svc"), "DuplicateServiceError"],
      [new ServiceNotFoundError("svc"), "ServiceNotFoundError"],
      [new ServiceNotRunningError("svc", "stopped"), "ServiceNotRunningError"],
      [new FatalServiceFailureError("svc", "create", new Error("boom")), "FatalServiceFailureError"],
      [new ServiceStopTimeoutError("svc", 5000), "ServiceStopTimeoutError"],
    ]
    for (const [err, expected] of cases) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(ServiceRegistryError)
      expect(err.name).toBe(expected)
    }
  })

  it("CircularDependencyError carries the cycle", () => {
    const cycle = ["a", "b", "c", "a"]
    const err = new CircularDependencyError(cycle)
    expect(err.cycle).toEqual(cycle)
    expect(err.message).toContain("a -> b -> c -> a")
  })

  it("ServiceDescriptor type accepts a minimal descriptor literal", () => {
    const descriptor: ServiceDescriptor<{ ready: boolean }> = {
      id: "core.fixture",
      criticality: "fatal",
      create: () => ({ ready: true }),
    }
    expect(descriptor.id).toBe("core.fixture")
    expect(descriptor.criticality).toBe("fatal")
    expect(descriptor.dependsOn).toBeUndefined()
  })
})
