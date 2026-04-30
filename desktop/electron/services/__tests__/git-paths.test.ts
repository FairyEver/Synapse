import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  isRepositoryRelativePath,
  toGitPath,
  toRepositoryGitPaths,
} from "../git-paths"

describe("git path helpers", () => {
  it("filters Windows cross-drive paths before passing paths to git", () => {
    expect(toRepositoryGitPaths(
      "C:\\work\\repo",
      [
        "C:\\work\\repo\\content\\rule.md",
        "C:\\work\\repo2\\content\\rule.md",
        "D:\\other\\rule.md",
      ],
      { pathApi: path.win32 },
    )).toEqual(["content/rule.md"])
  })

  it("deduplicates when requested", () => {
    expect(toRepositoryGitPaths(
      "/work/repo",
      ["/work/repo/a.md", "/work/repo/a.md"],
      { pathApi: path.posix, unique: true },
    )).toEqual(["a.md"])
  })

  it("keeps git paths slash separated", () => {
    expect(toGitPath("content\\skills\\SKILL.md")).toBe("content/skills/SKILL.md")
  })

  it("rejects parent escapes and absolute relative results", () => {
    expect(isRepositoryRelativePath("../outside.md", path.posix)).toBe(false)
    expect(isRepositoryRelativePath("D:\\outside.md", path.win32)).toBe(false)
  })
})
