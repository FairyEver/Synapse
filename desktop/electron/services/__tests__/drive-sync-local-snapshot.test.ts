import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createDefaultDriveSyncExcludeRules } from "../drive-sync-excludes"
import {
  hashDriveSyncFile,
  inspectDriveSyncLocalPath,
  scanDriveSyncLocalTree,
} from "../drive-sync-local-snapshot"

describe("drive sync local snapshot", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("inspects missing files, files, and empty folders", async () => {
    const filePath = path.join(tempDir, "note.md")
    const folderPath = path.join(tempDir, "empty")
    await writeFile(filePath, "hello", "utf8")
    await mkdir(folderPath)

    await expect(inspectDriveSyncLocalPath(path.join(tempDir, "missing.md"))).resolves.toEqual({ kind: "missing", empty: null })
    await expect(inspectDriveSyncLocalPath(filePath)).resolves.toMatchObject({ kind: "file", empty: null })
    await expect(inspectDriveSyncLocalPath(folderPath)).resolves.toEqual({ kind: "folder", empty: true })
  })

  it("scans included files and folders while skipping excluded paths and symlinks", async () => {
    await mkdir(path.join(tempDir, "docs"), { recursive: true })
    await mkdir(path.join(tempDir, ".git"), { recursive: true })
    await mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true })
    await writeFile(path.join(tempDir, "docs", "spec.md"), "spec", "utf8")
    await writeFile(path.join(tempDir, ".git", "config"), "git", "utf8")
    await writeFile(path.join(tempDir, "node_modules", "pkg", "index.js"), "pkg", "utf8")
    await symlink(path.join(tempDir, "docs", "spec.md"), path.join(tempDir, "docs", "link.md"))

    const entries = await scanDriveSyncLocalTree({
      rootPath: tempDir,
      rules: createDefaultDriveSyncExcludeRules(),
      hashFiles: true,
    })

    expect(entries.map((entry) => entry.relativePath).sort()).toEqual(["docs", "docs/spec.md"])
    expect(entries.find((entry) => entry.relativePath === "docs/spec.md")).toMatchObject({
      kind: "file",
      size: 4,
      hash: expect.stringMatching(/^sha256:/u),
    })
  })

  it("hashes files with a stable sha256 prefix", async () => {
    const filePath = path.join(tempDir, "note.md")
    await writeFile(filePath, "hello", "utf8")

    await expect(hashDriveSyncFile(filePath)).resolves.toMatch(/^sha256:/u)
  })
})
