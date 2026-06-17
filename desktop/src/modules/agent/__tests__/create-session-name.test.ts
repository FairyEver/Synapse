import { describe, expect, it } from "vitest"

import { formatCreateSessionName } from "../create-session-name"

describe("formatCreateSessionName", () => {
  it("formats afternoon names without zero-padding the hour", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 13, 30))).toBe("24日下午1:30")
  })

  it("formats morning names and pads minutes", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 3, 9, 5))).toBe("3日上午9:05")
  })

  it("formats noon as afternoon 12", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 12, 0))).toBe("24日下午12:00")
  })

  it("formats midnight as morning 12", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 0, 7))).toBe("24日上午12:07")
  })
})
