import { describe, expect, it } from "vitest"
import { formatBytes } from "./format-bytes.js"

describe("formatBytes", () => {
  it("formats byte sizes through TB", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1024 ** 4)).toBe("1 TB")
  })

  it("uses a configurable fallback for invalid values", () => {
    expect(formatBytes(-1)).toBe("-")
    expect(formatBytes(Number.NaN, { invalidFallback: "0 B" })).toBe("0 B")
    expect(formatBytes(null, { invalidFallback: "unknown" })).toBe("unknown")
  })
})
