import { afterEach, describe, expect, it, vi } from "vitest"
import { installReactPerformanceMeasureGuard } from "../react-performance-measure-guard"

describe("installReactPerformanceMeasureGuard", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("retries DataCloneError measures without detail", () => {
    const originalMeasure = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DOMException("Data cannot be cloned", "DataCloneError")
      })
      .mockReturnValue({ name: "component" })
    vi.stubGlobal("performance", { measure: originalMeasure })

    const cleanup = installReactPerformanceMeasureGuard()
    const measure = performance.measure("component", {
      detail: { devtools: { properties: [["props", "large"]] } },
      end: 12,
      start: 10,
    })

    expect(measure).toEqual({ name: "component" })
    expect(originalMeasure).toHaveBeenCalledTimes(2)
    expect(originalMeasure.mock.calls[1]?.[1]).toEqual({ end: 12, start: 10 })
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
})
