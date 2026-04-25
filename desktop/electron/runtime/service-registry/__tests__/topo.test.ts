import { describe, expect, it } from "vitest"
import {
  CircularDependencyError,
  UnknownDependencyError,
} from "../errors"
import { reverseTopoSort, topoSort, type TopoNode } from "../topo"

const node = (id: string, deps: string[] = []): TopoNode => ({
  id,
  dependsOn: deps,
})

describe("topoSort (T1.2)", () => {
  it("returns nodes in dependency order (deps first)", () => {
    const nodes = [node("c", ["a", "b"]), node("a"), node("b", ["a"])]
    const sorted = topoSort(nodes).map((n) => n.id)
    expect(sorted).toHaveLength(3)
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("b"))
    expect(sorted.indexOf("b")).toBeLessThan(sorted.indexOf("c"))
    expect(sorted.indexOf("a")).toBeLessThan(sorted.indexOf("c"))
  })

  it("preserves registration order for independent nodes (stable)", () => {
    const nodes = [node("z"), node("y"), node("x")]
    const sorted = topoSort(nodes).map((n) => n.id)
    expect(sorted).toEqual(["z", "y", "x"])
  })

  it("returns empty array for empty input", () => {
    expect(topoSort([])).toEqual([])
  })

  it("throws UnknownDependencyError when a dep is not registered", () => {
    const nodes = [node("a", ["ghost"])]
    expect(() => topoSort(nodes)).toThrowError(UnknownDependencyError)
    try {
      topoSort(nodes)
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownDependencyError)
      const e = err as UnknownDependencyError
      expect(e.serviceId).toBe("a")
      expect(e.missingId).toBe("ghost")
    }
  })

  it("detects a self-loop", () => {
    const nodes = [node("a", ["a"])]
    expect(() => topoSort(nodes)).toThrowError(CircularDependencyError)
    try {
      topoSort(nodes)
    } catch (err) {
      const e = err as CircularDependencyError
      expect(e.cycle[0]).toBe("a")
      expect(e.cycle[e.cycle.length - 1]).toBe("a")
    }
  })

  it("detects a 3-node cycle and surfaces the cycle path", () => {
    const nodes = [
      node("a", ["c"]),
      node("b", ["a"]),
      node("c", ["b"]),
    ]
    try {
      topoSort(nodes)
      throw new Error("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(CircularDependencyError)
      const e = err as CircularDependencyError
      expect(e.cycle.length).toBeGreaterThanOrEqual(2)
      expect(e.cycle[0]).toBe(e.cycle[e.cycle.length - 1])
      expect(new Set(e.cycle).size).toBeGreaterThanOrEqual(2)
    }
  })

  it("handles a diamond dependency", () => {
    const nodes = [
      node("d", ["b", "c"]),
      node("b", ["a"]),
      node("c", ["a"]),
      node("a"),
    ]
    const sorted = topoSort(nodes).map((n) => n.id)
    expect(sorted).toHaveLength(4)
    expect(sorted.indexOf("a")).toBe(0)
    expect(sorted.indexOf("d")).toBe(3)
  })

  it("reverseTopoSort is the exact reverse of topoSort", () => {
    const nodes = [
      node("d", ["b", "c"]),
      node("b", ["a"]),
      node("c", ["a"]),
      node("a"),
    ]
    const forward = topoSort(nodes).map((n) => n.id)
    const reverse = reverseTopoSort(nodes).map((n) => n.id)
    expect(reverse).toEqual([...forward].reverse())
  })

  it("isolated cycles do not crash a partially-sortable graph", () => {
    const nodes = [
      node("ok"),
      node("a", ["b"]),
      node("b", ["a"]),
    ]
    expect(() => topoSort(nodes)).toThrowError(CircularDependencyError)
  })
})
