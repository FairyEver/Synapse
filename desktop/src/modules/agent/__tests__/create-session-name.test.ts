import { describe, expect, it } from "vitest"

import { formatCreateSessionName } from "../create-session-name"

describe("formatCreateSessionName", () => {
  it("formats afternoon names with a 24-hour clock", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 13, 30))).toBe("新对话 13:30")
  })

  it("formats morning names and pads hours and minutes", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 3, 9, 5))).toBe("新对话 09:05")
  })

  it("formats noon as 12:00", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 12, 0))).toBe("新对话 12:00")
  })

  it("formats midnight as 00:07", () => {
    expect(formatCreateSessionName(new Date(2026, 5, 24, 0, 7))).toBe("新对话 00:07")
  })
})
