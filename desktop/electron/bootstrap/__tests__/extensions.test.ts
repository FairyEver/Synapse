import { describe, expect, it } from "vitest"
import { CONTENT_TYPE_DEFINITIONS } from "../../../src/config/content-types"
import { EXTENSION_POINT_IDS, registerCoreExtensions } from "../extensions"

describe("registerCoreExtensions (T6.10)", () => {
  it("registers every CONTENT_TYPE_DEFINITIONS entry into 'content.types'", () => {
    const { registry, contentTypes } = registerCoreExtensions()
    expect(contentTypes.map((c) => c.id).sort()).toEqual(
      CONTENT_TYPE_DEFINITIONS.map((d) => d.id).sort(),
    )
    const point = registry.point<{ id: string }>(EXTENSION_POINT_IDS.contentTypes)
    expect(point).not.toBeNull()
    expect(point!.list()).toHaveLength(CONTENT_TYPE_DEFINITIONS.length)
  })

  it("defines 'editors' and 'editor-scan.providers' points (empty lists for now)", () => {
    const { registry } = registerCoreExtensions()
    const editors = registry.point(EXTENSION_POINT_IDS.editors)
    const editorScan = registry.point(EXTENSION_POINT_IDS.editorScanProviders)
    expect(editors).not.toBeNull()
    expect(editorScan).not.toBeNull()
    expect(editors!.list()).toEqual([])
    expect(editorScan!.list()).toEqual([])
  })

  it("returns the same registry instance when called twice (idempotent definePoint)", () => {
    const { registry } = registerCoreExtensions()
    const result = registerCoreExtensions(registry)
    expect(result.registry).toBe(registry)
    // Caller can still iterate the same point; the second call adds duplicates
    // because re-registering content types is the contract today. M5 plugin
    // system will swap that for explicit `replace` semantics.
    const point = registry.point<{ id: string }>(EXTENSION_POINT_IDS.contentTypes)
    expect(point!.list().length).toBe(CONTENT_TYPE_DEFINITIONS.length * 2)
  })
})
