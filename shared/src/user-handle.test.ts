import { describe, expect, it } from "vitest"
import { normalizeUserHandle, userHandleMaxLength } from "./user-handle.js"

describe("account username validation", () => {
  it("normalizes usernames independently of cloud Skills", () => {
    expect(normalizeUserHandle(" Li-Yang ")).toBe("li-yang")
    expect(normalizeUserHandle("u".repeat(userHandleMaxLength))).toHaveLength(userHandleMaxLength)
  })
  it.each(["li.yang", "-liyang", "console", "con", "", "u".repeat(userHandleMaxLength + 1)])("rejects invalid username %s", (value) => {
    expect(() => normalizeUserHandle(value)).toThrow()
  })
})
