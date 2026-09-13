import { describe, expect, it, vi } from "vitest"
import { boundedTimelinePage } from "../timeline-page"

describe("boundedTimelinePage", () => {
  it("only projects the requested tail of a large single turn", () => {
    const project = vi.fn((index: number) => ({ id: index }))
    const page = boundedTimelinePage({ endIndex: 100_000, limit: 100, maxBytes: 1024 * 1024, project })
    expect(project).toHaveBeenCalledTimes(100)
    expect(page.startIndex).toBe(99_900)
    expect(page.entries.map((entry) => entry.id)).toEqual(Array.from({ length: 100 }, (_, i) => 99_900 + i))
  })

  it("counts serialized UTF-8 bytes including escaping and traverses every record", () => {
    const records = Array.from({ length: 23 }, (_, id) => ({ id, text: '界\n"\\'.repeat(20) }))
    const all: typeof records = []
    let endIndex = records.length
    while (endIndex > 0) {
      const page = boundedTimelinePage({ endIndex, limit: 100, maxBytes: 1024, project: (i) => records[i]! })
      expect(Buffer.byteLength(JSON.stringify(page.entries), "utf8")).toBeLessThanOrEqual(1024)
      expect(page.startIndex).toBeLessThan(endIndex)
      all.unshift(...page.entries)
      endIndex = page.startIndex
    }
    expect(all).toEqual(records)
  })

  it("fails explicitly when one projected record cannot fit instead of returning an empty page", () => {
    expect(() => boundedTimelinePage({ endIndex: 1, limit: 100, maxBytes: 100, project: () => "x".repeat(101) }))
      .toThrow("Timeline entry exceeds page byte budget")
  })

  it("ends at zero without projecting a record", () => {
    const project = vi.fn()
    expect(boundedTimelinePage({ endIndex: 0, limit: 100, maxBytes: 1024, project }))
      .toEqual({ entries: [], startIndex: 0 })
    expect(project).not.toHaveBeenCalled()
  })
})
