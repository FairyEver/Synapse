import { describe, expect, it } from "vitest"

import { formatDurationMs } from "../duration"

describe("formatDurationMs", () => {
  it.each([
    [0, "0毫秒"],
    [200, "200毫秒"],
    [999, "999毫秒"],
    [1000, "1秒"],
    [45_000, "45秒"],
    [59_999, "59秒"],
    [60_000, "1分钟"],
    [68_900, "1分钟9秒"],
    [72_000, "1分钟12秒"],
    [1_858_400, "30分钟58秒"],
  ])("formats %i milliseconds as %s", (durationMs, expected) => {
    expect(formatDurationMs(durationMs)).toBe(expected)
  })
})
