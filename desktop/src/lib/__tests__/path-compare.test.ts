import { describe, expect, it } from "vitest"

import { arePathsEqualForCompare, isPathInsideDirectory, normalizePathForCompare } from "../path-compare"

describe("path compare helpers", () => {
  it("normalizes trailing separators and Windows case", () => {
    expect(normalizePathForCompare("C:/Users/Ada/Repo/", { platform: "win32" }))
      .toBe("c:\\users\\ada\\repo")
  })

  it("normalizes dot segments before comparing paths", () => {
    expect(arePathsEqualForCompare("/workspace/tmp/../repo", "/workspace/repo/", {
      platform: "linux",
    })).toBe(true)
  })

  it("normalizes Windows dot segments before comparing paths", () => {
    expect(arePathsEqualForCompare("C:/Users/Ada/tmp/../Repo", "c:\\users\\ada\\repo\\", {
      platform: "win32",
    })).toBe(true)
  })

  it("uses injected path resolution when provided", () => {
    expect(arePathsEqualForCompare("repo", "/workspace/repo/", {
      platform: "linux",
      resolvePath: (value) => value === "repo" ? "/workspace/repo" : value,
    })).toBe(true)
  })

  it("detects same or descendant paths without prefix false positives", () => {
    expect(isPathInsideDirectory("/workspace/repo", "/workspace/repo/docs/a.md", { platform: "linux" })).toBe(true)
    expect(isPathInsideDirectory("/workspace/repo", "/workspace/repo-copy/docs/a.md", { platform: "linux" })).toBe(false)
  })

  it("detects Windows descendants with case and separator normalization", () => {
    expect(isPathInsideDirectory("C:/Users/Ada/Repo", "c:\\users\\ada\\repo\\docs\\a.md", { platform: "win32" })).toBe(true)
    expect(isPathInsideDirectory("C:/Users/Ada/Repo", "c:\\users\\ada\\repo-copy\\a.md", { platform: "win32" })).toBe(false)
  })
})
