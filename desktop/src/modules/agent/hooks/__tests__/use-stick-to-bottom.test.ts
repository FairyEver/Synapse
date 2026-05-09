import { describe, expect, it } from "vitest"

import {
  PINNED_THRESHOLD_PX,
  computeIsPinned,
  isLatestEntryNew,
} from "../use-stick-to-bottom"

describe("computeIsPinned", () => {
  it("treats content shorter than the viewport as pinned", () => {
    expect(computeIsPinned({ scrollTop: 0, scrollHeight: 500, clientHeight: 800 })).toBe(true)
    expect(computeIsPinned({ scrollTop: 0, scrollHeight: 800, clientHeight: 800 })).toBe(true)
  })

  it("returns true when the user is within PINNED_THRESHOLD_PX of the bottom", () => {
    const clientHeight = 600
    const scrollHeight = 2000
    const scrollTop = scrollHeight - clientHeight - (PINNED_THRESHOLD_PX - 1)
    expect(computeIsPinned({ scrollTop, scrollHeight, clientHeight })).toBe(true)
  })

  it("returns false when the user is further than PINNED_THRESHOLD_PX from the bottom", () => {
    const clientHeight = 600
    const scrollHeight = 2000
    const scrollTop = scrollHeight - clientHeight - (PINNED_THRESHOLD_PX + 50)
    expect(computeIsPinned({ scrollTop, scrollHeight, clientHeight })).toBe(false)
  })

  it("uses the default threshold of 80px", () => {
    expect(PINNED_THRESHOLD_PX).toBe(80)
  })
})

describe("isLatestEntryNew", () => {
  it("returns false when there is no latest entry", () => {
    expect(isLatestEntryNew({ previousId: undefined, latestId: undefined })).toBe(false)
    expect(isLatestEntryNew({ previousId: "a", latestId: undefined })).toBe(false)
  })

  it("returns false when the id is unchanged (e.g. only `sending` toggled)", () => {
    expect(isLatestEntryNew({ previousId: "a", latestId: "a" })).toBe(false)
  })

  it("returns true when the latest entry id changed to a new value", () => {
    expect(isLatestEntryNew({ previousId: "a", latestId: "b" })).toBe(true)
  })

  it("returns true when the first entry appears after an empty timeline", () => {
    expect(isLatestEntryNew({ previousId: undefined, latestId: "a" })).toBe(true)
  })
})
