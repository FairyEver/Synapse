import { describe, expect, it } from "vitest"

import { arePathsEqualForCompare, normalizePathForCompare } from "../path-compare"

describe("path compare helpers", () => {
  it("normalizes trailing separators and Windows case", () => {
    expect(normalizePathForCompare("C:/Users/Ada/Repo/", { platform: "win32" }))
      .toBe("c:\\users\\ada\\repo")
  })

  it("uses injected path resolution when provided", () => {
    expect(arePathsEqualForCompare("repo", "/workspace/repo/", {
      platform: "linux",
      resolvePath: (value) => value === "repo" ? "/workspace/repo" : value,
    })).toBe(true)
  })
})
