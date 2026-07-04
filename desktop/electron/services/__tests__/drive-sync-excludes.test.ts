import { describe, expect, it } from "vitest"
import {
  DRIVE_SYNC_DEFAULT_EXCLUDES,
  DRIVE_SYNC_FORCED_EXCLUDES,
  createDefaultDriveSyncExcludeRules,
  isDriveSyncExcluded,
  parseGitignoreForDriveSync,
} from "../drive-sync-excludes"

describe("drive sync exclude utilities", () => {
  it("defines forced and default exclude rules", () => {
    expect(DRIVE_SYNC_FORCED_EXCLUDES).toContain(".git/**")
    expect(DRIVE_SYNC_DEFAULT_EXCLUDES).toContain("node_modules/**")
    expect(DRIVE_SYNC_DEFAULT_EXCLUDES).toContain("*.log")
  })

  it("always excludes .git and sync temporary paths", () => {
    const rules = createDefaultDriveSyncExcludeRules()

    expect(isDriveSyncExcluded(".git/config", rules)).toBe(true)
    expect(isDriveSyncExcluded(".git", rules)).toBe(true)
    expect(isDriveSyncExcluded(".synapse-sync/download.tmp", rules)).toBe(true)
    expect(isDriveSyncExcluded("notes.synapse-sync-tmp", rules)).toBe(true)
    expect(isDriveSyncExcluded(".synapse-sync-trash", rules)).toBe(true)
    expect(isDriveSyncExcluded(".synapse-sync-trash/removed.md", rules)).toBe(true)
    expect(isDriveSyncExcluded(".synapse-drive-sync-123.tmp", rules)).toBe(true)
    expect(isDriveSyncExcluded("nested/.synapse-drive-sync-123.tmp", rules)).toBe(true)
    expect(isDriveSyncExcluded("packages/app/.git/config", rules)).toBe(true)
  })

  it("excludes default build and log paths", () => {
    const rules = createDefaultDriveSyncExcludeRules()

    expect(isDriveSyncExcluded("node_modules/pkg/index.js", rules)).toBe(true)
    expect(isDriveSyncExcluded("packages/app/node_modules/pkg/index.js", rules)).toBe(true)
    expect(isDriveSyncExcluded("dist/app.js", rules)).toBe(true)
    expect(isDriveSyncExcluded("packages/app/dist/app.js", rules)).toBe(true)
    expect(isDriveSyncExcluded("debug.log", rules)).toBe(true)
    expect(isDriveSyncExcluded("docs/spec.md", rules)).toBe(false)
    expect(isDriveSyncExcluded("packages/app/mydist/app.js", rules)).toBe(false)
  })

  it("applies imported gitignore and user rules without rereading .gitignore", () => {
    const rules = {
      ...createDefaultDriveSyncExcludeRules(),
      importedGitignore: ["secrets/**", "**/*.pem", "docs/**/index.md"],
      user: ["private/**", "foo/*/bar.md"],
    }

    expect(isDriveSyncExcluded("secrets/token.txt", rules)).toBe(true)
    expect(isDriveSyncExcluded("packages/app/secrets/token.txt", rules)).toBe(true)
    expect(isDriveSyncExcluded("certs/client.pem", rules)).toBe(true)
    expect(isDriveSyncExcluded("client.pem", rules)).toBe(true)
    expect(isDriveSyncExcluded("docs/index.md", rules)).toBe(true)
    expect(isDriveSyncExcluded("docs/a/b/index.md", rules)).toBe(true)
    expect(isDriveSyncExcluded("private/note.md", rules)).toBe(true)
    expect(isDriveSyncExcluded("packages/app/private/note.md", rules)).toBe(true)
    expect(isDriveSyncExcluded("foo/a/bar.md", rules)).toBe(true)
    expect(isDriveSyncExcluded("foo/a/b/bar.md", rules)).toBe(false)
    expect(isDriveSyncExcluded(".gitignore", rules)).toBe(false)
  })

  it("parses gitignore content into copied binding rules", () => {
    expect(parseGitignoreForDriveSync("# comment\n\nsecrets/\n!important.md\n*.tmp\n")).toEqual(["secrets/**", "*.tmp"])
  })
})
