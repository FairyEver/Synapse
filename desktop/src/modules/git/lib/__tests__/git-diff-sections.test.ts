import { describe, expect, it } from "vitest"
import { isBinaryGitDiff, mapCommitDiffSections, splitGitDiffSections } from "../git-diff-sections"

const firstPatch = [
  "diff --git a/docs/a.md b/docs/a.md",
  "index 1111111..2222222 100644",
  "--- a/docs/a.md",
  "+++ b/docs/a.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n")

const secondPatch = [
  "diff --git a/docs/old.md b/docs/new.md",
  "similarity index 90%",
  "rename from docs/old.md",
  "rename to docs/new.md",
  "@@ -1 +1 @@",
  "-旧内容",
  "+新内容",
  "",
].join("\n")

describe("git diff sections", () => {
  it("splits a multi-file patch only at file headers", () => {
    const sections = splitGitDiffSections(`${firstPatch}${secondPatch}`)

    expect(sections).toHaveLength(2)
    expect(sections[0]).toContain("+new")
    expect(sections[1]).toContain("rename to docs/new.md")
  })

  it("does not split content that merely contains a diff header", () => {
    const patch = firstPatch.replace("+new", "+diff --git is visible content")

    expect(splitGitDiffSections(patch)).toEqual([patch])
  })

  it("maps unicode and renamed files to their patches", () => {
    expect(mapCommitDiffSections(`${firstPatch}${secondPatch}`, [
      { path: "文档/a.md", originalPath: null, status: "modified" },
      { path: "docs/new.md", originalPath: "docs/old.md", status: "renamed" },
    ])).toEqual([
      expect.objectContaining({ path: "文档/a.md", originalPath: null, text: firstPatch }),
      expect.objectContaining({ path: "docs/new.md", originalPath: "docs/old.md", text: secondPatch }),
    ])
  })

  it("rejects incomplete file-to-patch mappings", () => {
    expect(mapCommitDiffSections(firstPatch, [
      { path: "docs/a.md", originalPath: null, status: "modified" },
      { path: "docs/b.md", originalPath: null, status: "added" },
    ])).toBeNull()
  })

  it("keeps nonstandard and empty patches available for fallback", () => {
    expect(splitGitDiffSections("@@ -1 +1 @@\n-old\n+new\n")).toEqual(["@@ -1 +1 @@\n-old\n+new\n"])
    expect(splitGitDiffSections("\n")).toEqual([])
  })

  it("detects regular and Git binary patches", () => {
    expect(isBinaryGitDiff("Binary files a/logo.png and b/logo.png differ\n")).toBe(true)
    expect(isBinaryGitDiff("GIT binary patch\nliteral 0\n")).toBe(true)
    expect(isBinaryGitDiff(firstPatch)).toBe(false)
  })
})
