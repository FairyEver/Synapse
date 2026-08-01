import { describe, expect, it } from "vitest"
import { parseGitStatusPorcelainV2 } from "../git-status-parser"

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
      "u UU N... 100644 100644 100644 100644 a b c d docs/conflict.md",
    ].join("\n"))

    expect(snapshot.currentBranch).toBe("main")
    expect(snapshot.upstream).toBe("origin/main")
    expect(snapshot.trackingStatus).toBe("tracked")
    expect(snapshot.ahead).toBe(2)
    expect(snapshot.behind).toBe(1)
    expect(snapshot.hasConflicts).toBe(true)
    expect(snapshot.changes).toEqual([
      { path: "docs/intro.md", originalPath: null, status: "modified", staged: false, conflicted: false },
      { path: "docs/old.md", originalPath: null, status: "deleted", staged: true, conflicted: false },
      { path: "docs/new.md", originalPath: null, status: "untracked", staged: false, conflicted: false },
      { path: "docs/conflict.md", originalPath: null, status: "conflicted", staged: false, conflicted: true },
    ])
  })

  it("distinguishes branches without upstream from detached HEAD", () => {
    expect(parseGitStatusPorcelainV2("# branch.head feature\n").trackingStatus).toBe("untracked")
    expect(parseGitStatusPorcelainV2("# branch.head (detached)\n").trackingStatus).toBe("detached")
  })

  it("parses renamed files", () => {
    const snapshot = parseGitStatusPorcelainV2(
      "2 R. N... 100644 100644 100644 abc abc R100 docs/new-name.md\t docs/old-name.md",
    )

    expect(snapshot.changes).toEqual([
      { path: "docs/new-name.md", originalPath: "docs/old-name.md", status: "renamed", staged: true, conflicted: false },
    ])
  })

  it("decodes Git quoted paths before returning changes", () => {
    const snapshot = parseGitStatusPorcelainV2([
      "1 .M N... 100644 100644 100644 abc abc \"docs/\\344\\270\\255\\346\\226\\207 file.ts\"",
      "? \"docs/line\\nname.txt\"",
      "2 R. N... 100644 100644 100644 abc abc R100 \"docs/\\346\\226\\260 name.md\"\t\"docs/old\\040name.md\"",
    ].join("\n"))

    expect(snapshot.changes).toEqual([
      { path: "docs/中文 file.ts", originalPath: null, status: "modified", staged: false, conflicted: false },
      { path: "docs/line\nname.txt", originalPath: null, status: "untracked", staged: false, conflicted: false },
      { path: "docs/新 name.md", originalPath: "docs/old name.md", status: "renamed", staged: true, conflicted: false },
    ])
  })
})
