import { describe, expect, it } from "vitest"
import { createGitStatusPorcelainV2Parser, parseGitStatusPorcelainV2 } from "../git-status-parser"

describe("parseGitStatusPorcelainV2", () => {
  it("parses branch, ahead behind, and common file states", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "# branch.oid 0f00abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc abc docs/intro.md",
      "1 D. N... 100644 000000 000000 abc 000000 docs/old.md",
      "? docs/new.md",
      "u UU N... 100644 100644 100644 100644 a b c docs/conflict.md",
    ].join("\n"))

    expect(snapshot.currentBranch).toBe("main")
    expect(snapshot.upstream).toBe("origin/main")
    expect(snapshot.trackingStatus).toBe("tracked")
    expect(snapshot.ahead).toBe(2)
    expect(snapshot.behind).toBe(1)
    expect(snapshot.hasConflicts).toBe(true)
    expect(snapshot.changes).toEqual([
      { path: "docs/intro.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
      { path: "docs/old.md", originalPath: null, status: "deleted", indexStatus: "deleted", worktreeStatus: "unchanged" },
      { path: "docs/new.md", originalPath: null, status: "untracked", indexStatus: "unchanged", worktreeStatus: "untracked" },
      { path: "docs/conflict.md", originalPath: null, status: "conflicted", indexStatus: "unmerged", worktreeStatus: "unmerged" },
    ])
  })

  it("distinguishes branches without upstream from detached HEAD", () => {
    expect(parseGitStatusPorcelainV2("# branch.head feature\n").trackingStatus).toBe("untracked")
    expect(parseGitStatusPorcelainV2("# branch.head (detached)\n").trackingStatus).toBe("detached")
  })

  it("reports an upstream that no longer exists", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "# branch.head main",
      "# branch.upstream origin/main",
    ].join("\n"))

    expect(snapshot.trackingStatus).toBe("gone")
    expect(snapshot.upstream).toBe("origin/main")
    expect(snapshot.ahead).toBe(0)
    expect(snapshot.behind).toBe(0)
  })

  it("parses renamed files", () => {
    const snapshot = parseGitStatusPorcelainV2(
      "2 R. N... 100644 100644 100644 abc abc R100 docs/new-name.md\t docs/old-name.md",
    )

    expect(snapshot.changes).toEqual([
      { path: "docs/new-name.md", originalPath: "docs/old-name.md", status: "renamed", indexStatus: "renamed", worktreeStatus: "unchanged" },
    ])
  })

  it("parses real unmerged records and type changes", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "u UU N... 100644 100644 100644 100644 a b c docs/conflict with spaces.md",
      "1 .T N... 100644 100644 120000 a b docs/link.md",
    ].join("\n"))

    expect(snapshot.hasConflicts).toBe(true)
    expect(snapshot.changes).toEqual([
      { path: "docs/conflict with spaces.md", originalPath: null, status: "conflicted", indexStatus: "unmerged", worktreeStatus: "unmerged" },
      { path: "docs/link.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
    ])
  })

  it("decodes Git quoted paths before returning changes", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "1 .M N... 100644 100644 100644 abc abc \"docs/\\344\\270\\255\\346\\226\\207 file.ts\"",
      "? \"docs/line\\nname.txt\"",
      "2 R. N... 100644 100644 100644 abc abc R100 \"docs/\\346\\226\\260 name.md\"\t\"docs/old\\040name.md\"",
    ].join("\n"))

    expect(snapshot.changes).toEqual([
      { path: "docs/中文 file.ts", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
      { path: "docs/line\nname.txt", originalPath: null, status: "untracked", indexStatus: "unchanged", worktreeStatus: "untracked" },
      { path: "docs/新 name.md", originalPath: "docs/old name.md", status: "renamed", indexStatus: "renamed", worktreeStatus: "unchanged" },
    ])
  })

  it("streams NUL-delimited status without retaining every change", () => {
    const parser = createGitStatusPorcelainV2Parser({ maxChanges: 2 })
    const output = Buffer.from([
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 abc abc docs/line\nname.md",
      "2 R. N... 100644 100644 100644 abc abc R100 docs/new name.md",
      "docs/old name.md",
      "? docs/third.md",
      "u UU N... 100644 100644 100644 100644 a b c docs/conflict.md",
      "",
    ].join("\0"), "utf8")

    parser.push(output.subarray(0, 37))
    parser.push(output.subarray(37, 113))
    parser.push(output.subarray(113))

    expect(parser.finish()).toEqual({
      currentBranch: "main",
      upstream: "origin/main",
      trackingStatus: "tracked",
      ahead: 2,
      behind: 1,
      hasConflicts: true,
      changeCount: 4,
      changesTruncated: true,
      changes: [
        { path: "docs/line\nname.md", originalPath: null, status: "modified", indexStatus: "unchanged", worktreeStatus: "modified" },
        { path: "docs/new name.md", originalPath: "docs/old name.md", status: "renamed", indexStatus: "renamed", worktreeStatus: "unchanged" },
      ],
    })
  })
})
