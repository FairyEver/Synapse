import { describe, expect, it } from "vitest"
import { createExtensionRegistry } from "../index"

interface ContentType {
  readonly id: string
  readonly displayName: string
}

describe("ExtensionRegistry (T6.9)", () => {
  it("definePoint twice returns the same point (idempotent)", () => {
    const reg = createExtensionRegistry()
    const a = reg.definePoint<ContentType>("content.types")
    const b = reg.definePoint<ContentType>("content.types")
    expect(a).toBe(b)
  })

  it("register adds contributions in order, list snapshots them", () => {
    const reg = createExtensionRegistry()
    const point = reg.definePoint<ContentType>("content.types")
    point.register({ id: "rule", displayName: "Rules" })
    point.register({ id: "skill", displayName: "Skills" })
    expect(point.list().map((c) => c.id)).toEqual(["rule", "skill"])
  })

  it("returned unsubscriber removes the contribution", () => {
    const reg = createExtensionRegistry()
    const point = reg.definePoint<ContentType>("content.types")
    const unsub = point.register({ id: "rule", displayName: "Rules" })
    expect(point.list()).toHaveLength(1)
    unsub()
    expect(point.list()).toEqual([])
  })

  it("point() returns null for unknown ids", () => {
    const reg = createExtensionRegistry()
    expect(reg.point("ghost")).toBeNull()
  })

  it("listPoints reports every defined extension point", () => {
    const reg = createExtensionRegistry()
    reg.definePoint("a")
    reg.definePoint("b")
    expect([...reg.listPoints()].sort()).toEqual(["a", "b"])
  })
})
