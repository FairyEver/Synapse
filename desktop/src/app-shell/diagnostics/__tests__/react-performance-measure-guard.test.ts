import { afterEach, describe, expect, it, vi } from "vitest"
import { performance as nodePerformance } from "node:perf_hooks"
import { installReactPerformanceMeasureGuard, REACT_MEASURE_RETENTION_LIMIT } from "../react-performance-measure-guard"

describe("installReactPerformanceMeasureGuard", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("removes detail before Chromium attempts to serialize it", () => {
    const originalMeasure = vi.fn((_name: string, options?: PerformanceMeasureOptions | string) => {
      if (typeof options === "object" && options !== null && "detail" in options) {
        throw new Error("unsafe detail reached the native serializer")
      }
      return { name: "component" }
    })
    vi.stubGlobal("performance", { measure: originalMeasure })

    const cleanup = installReactPerformanceMeasureGuard()
    const measure = performance.measure("component", {
      detail: { devtools: { properties: [["props", "large"]] } },
      end: 12,
      start: 10,
    })

    expect(measure).toEqual({ name: "component" })
    expect(originalMeasure).toHaveBeenCalledTimes(1)
    expect(originalMeasure.mock.calls[0]?.[1]).toEqual({ end: 12, start: 10 })
    cleanup()
    expect(performance.measure).toBe(originalMeasure)
  })

  it("keeps non-DataCloneError failures visible", () => {
    const originalMeasure = vi.fn(() => {
      throw new Error("invalid measure")
    })
    vi.stubGlobal("performance", { measure: originalMeasure })

    installReactPerformanceMeasureGuard()

    expect(() => {
      performance.measure("bad", { detail: { devtools: {} } })
    }).toThrow("invalid measure")
    expect(originalMeasure).toHaveBeenCalledTimes(1)
  })

  it("keeps measures without detail unchanged", () => {
    const originalMeasure = vi.fn(() => ({ name: "component" }))
    vi.stubGlobal("performance", { measure: originalMeasure })

    installReactPerformanceMeasureGuard()
    performance.measure("component", "start", "end")

    expect(originalMeasure).toHaveBeenCalledWith("component", "start", "end")
  })

  it.each([1_000, 10_000, 100_000])("bounds %i React entries and preserves unrelated same-name diagnostics", (count) => {
    vi.stubGlobal("performance", nodePerformance)
    const cleanup = installReactPerformanceMeasureGuard()
    try {
      performance.measure("same-name", { start: 0, end: 1 })
      performance.mark("business-mark")
      for (let index = 0; index < count; index += 1) {
        performance.measure(index === 0 ? "same-name" : `component-${index}`, {
          start: 0,
          end: 1,
          detail: { devtools: { track: "Components ⚛", properties: [["payload", "synthetic"]] } },
        })
      }
      expect(performance.getEntriesByType("measure")).toHaveLength(REACT_MEASURE_RETENTION_LIMIT + 1)
      expect(performance.getEntriesByName("same-name")).toHaveLength(1)
      expect(performance.getEntriesByName("business-mark")).toHaveLength(1)
      cleanup()
      expect(performance.getEntriesByType("measure")).toHaveLength(1)
    } finally {
      cleanup()
      performance.clearMeasures("same-name")
      performance.clearMarks("business-mark")
    }
  })

  it("bounds repeated React scheduler labels and releases them on uninstall", () => {
    vi.stubGlobal("performance", nodePerformance)
    const cleanup = installReactPerformanceMeasureGuard()
    for (let index = 0; index < 1_000; index += 1) {
      performance.measure("Render", { start: 0, end: 1, detail: { devtools: { trackGroup: "Scheduler ⚛" } } })
    }
    expect(performance.getEntriesByType("measure").length).toBeLessThanOrEqual(REACT_MEASURE_RETENTION_LIMIT)
    cleanup()
    expect(performance.getEntriesByType("measure")).toHaveLength(0)
  })
})
