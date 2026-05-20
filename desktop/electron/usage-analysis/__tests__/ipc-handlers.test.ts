import { describe, expect, it } from "vitest"
import { normalizeUsageRangeForIpc } from "../ipc-handlers"

describe("usage analysis ipc handlers", () => {
  it("accepts today range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "today" })).toEqual({ preset: "today" })
  })

  it("accepts valid trend bucket granularity", () => {
    expect(normalizeUsageRangeForIpc({ preset: "30d", bucket: "hour" })).toEqual({
      preset: "30d",
      bucket: "hour",
    })
  })

  it("drops invalid trend bucket granularity", () => {
    expect(normalizeUsageRangeForIpc({ preset: "30d", bucket: "minute" })).toEqual({ preset: "30d" })
  })

  it("falls back to 30d for unknown range preset", () => {
    expect(normalizeUsageRangeForIpc({ preset: "unknown" })).toEqual({ preset: "30d" })
  })
})
