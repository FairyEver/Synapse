import { describe, expect, it } from "vitest"
import {
  ONE_M_CONTEXT_TOKENS,
  hasOneMMarker,
  setOneMMarker,
  stripOneMMarker,
} from "./model-context.js"

describe("hasOneMMarker", () => {
  it("matches a trailing marker case-insensitively", () => {
    expect(hasOneMMarker("deepseek-flash[1M]")).toBe(true)
    expect(hasOneMMarker("deepseek-flash[1m]")).toBe(true)
    expect(hasOneMMarker("k3[1m]")).toBe(true)
  })

  it("ignores trailing whitespace", () => {
    expect(hasOneMMarker("deepseek-flash[1M]  ")).toBe(true)
  })

  it("rejects markers that are not at the end", () => {
    expect(hasOneMMarker("deepseek-flash")).toBe(false)
    expect(hasOneMMarker("[1M]deepseek-flash")).toBe(false)
    expect(hasOneMMarker("deepseek-flash[1M]-pro")).toBe(false)
    expect(hasOneMMarker("")).toBe(false)
  })
})

describe("stripOneMMarker", () => {
  it("removes the marker and trailing whitespace", () => {
    expect(stripOneMMarker("deepseek-flash[1M]")).toBe("deepseek-flash")
    expect(stripOneMMarker("deepseek-flash[1m]  ")).toBe("deepseek-flash")
  })

  it("is idempotent and removes repeated markers", () => {
    expect(stripOneMMarker("deepseek-flash[1M][1M]")).toBe("deepseek-flash")
    const once = stripOneMMarker("deepseek-flash[1M]")
    expect(stripOneMMarker(once)).toBe(once)
  })

  it("leaves unmarked ids untouched", () => {
    expect(stripOneMMarker("deepseek-v4-pro")).toBe("deepseek-v4-pro")
    expect(stripOneMMarker("")).toBe("")
  })
})

describe("setOneMMarker", () => {
  it("adds and removes the marker", () => {
    expect(setOneMMarker("deepseek-flash", true)).toBe("deepseek-flash[1M]")
    expect(setOneMMarker("deepseek-flash[1m]", false)).toBe("deepseek-flash")
  })

  it("does not duplicate an existing marker", () => {
    expect(setOneMMarker("deepseek-flash[1M]", true)).toBe("deepseek-flash[1M]")
    expect(setOneMMarker("deepseek-flash[1m][1M]", true)).toBe("deepseek-flash[1M]")
  })

  it("keeps an empty model empty", () => {
    expect(setOneMMarker("", true)).toBe("")
    expect(setOneMMarker("   ", true)).toBe("")
  })
})

describe("ONE_M_CONTEXT_TOKENS", () => {
  it("is the window Claude Code assumes for a 1M model", () => {
    expect(ONE_M_CONTEXT_TOKENS).toBe(1_000_000)
  })
})
