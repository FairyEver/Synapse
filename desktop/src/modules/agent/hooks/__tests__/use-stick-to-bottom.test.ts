import { describe, expect, it } from "vitest"

import {
  PINNED_THRESHOLD_PX,
  computeIsPinned,
  isLatestEntryNew,
  latestTimelineContentSignal,
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

  it("treats the exact threshold distance as pinned", () => {
    const clientHeight = 600
    const scrollHeight = 2000
    const scrollTop = scrollHeight - clientHeight - PINNED_THRESHOLD_PX
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

describe("latestTimelineContentSignal", () => {
  it("changes when a streamed assistant message grows without a new item id", () => {
    const first = latestTimelineContentSignal({
      id: "event:stream:1",
      kind: "message",
      role: "assistant",
      content: "Partial",
      timestamp: "2026-05-15T00:00:00.000Z",
    })
    const next = latestTimelineContentSignal({
      id: "event:stream:1",
      kind: "message",
      role: "assistant",
      content: "Partial answer",
      timestamp: "2026-05-15T00:00:00.000Z",
    })

    expect(next).not.toBe(first)
    expect(next).toBe("message:assistant:14")
  })

  it("summarizes tool result changes by status and content length only", () => {
    expect(latestTimelineContentSignal({
      id: "event:tool:1",
      kind: "toolResult",
      toolName: "Read",
      content: "secret file contents",
      status: "success",
      success: true,
      timestamp: "2026-05-15T00:00:00.000Z",
    })).toBe("toolResult:Read:success:true:20")
  })
})
