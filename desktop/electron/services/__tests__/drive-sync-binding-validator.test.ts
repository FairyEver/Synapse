import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import { previewDriveSyncBinding } from "../drive-sync-binding-validator"

describe("drive sync binding validator", () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-bind-"))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("allows remote files to bind to missing local files", async () => {
    await expect(previewDriveSyncBinding({
      driveItemId: "item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: path.join(tempDir, "spec.md"),
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({
      status: "ready",
      direction: "remote_to_local",
      localKind: "missing",
    })
  })

  it("allows local files to bind to new remote targets", async () => {
    const localPath = path.join(tempDir, "spec.md")
    await writeFile(localPath, "spec", "utf8")

    await expect(previewDriveSyncBinding({
      driveItemId: "new-item",
      driveItemName: "spec.md",
      kind: "file",
      localPath,
      remoteExists: false,
      activeBindings: [],
    })).resolves.toMatchObject({
      status: "ready",
      direction: "local_to_remote",
      localKind: "file",
    })
  })

  it("blocks ambiguous two-sided file bindings", async () => {
    const localPath = path.join(tempDir, "spec.md")
    await writeFile(localPath, "spec", "utf8")

    await expect(previewDriveSyncBinding({
      driveItemId: "item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath,
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({
      status: "blocked",
      direction: null,
    })
  })

  it("allows remote folders to bind to missing or empty local folders and blocks non-empty folders", async () => {
    const emptyFolder = path.join(tempDir, "empty")
    const fullFolder = path.join(tempDir, "full")
    await mkdir(emptyFolder)
    await mkdir(fullFolder)
    await writeFile(path.join(fullFolder, "note.md"), "note", "utf8")

    await expect(previewDriveSyncBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: path.join(tempDir, "missing"),
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({ status: "ready", direction: "remote_to_local", localKind: "missing" })
    await expect(previewDriveSyncBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: emptyFolder,
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({ status: "ready", direction: "remote_to_local", localKind: "folder", localEmpty: true })
    await expect(previewDriveSyncBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: fullFolder,
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({ status: "blocked", direction: null, localKind: "folder", localEmpty: false })
  })

  it("blocks type mismatch and duplicate bindings", async () => {
    const filePath = path.join(tempDir, "spec.md")
    await writeFile(filePath, "spec", "utf8")
    const activeBindings = [createBinding({ driveItemId: "item-1", localPath: path.join(tempDir, "bound") })]

    await expect(previewDriveSyncBinding({
      driveItemId: "folder-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: filePath,
      remoteExists: true,
      activeBindings: [],
    })).resolves.toMatchObject({ status: "blocked" })
    await expect(previewDriveSyncBinding({
      driveItemId: "item-1",
      driveItemName: "Spec",
      kind: "file",
      localPath: path.join(tempDir, "other.md"),
      remoteExists: true,
      activeBindings,
    })).resolves.toMatchObject({ status: "blocked", reason: "云盘条目已绑定。" })
  })

  it("copies gitignore rules once when requested", async () => {
    const folder = path.join(tempDir, "repo")
    await mkdir(folder)
    await writeFile(path.join(folder, ".gitignore"), "secrets/\n*.tmp\n", "utf8")

    await expect(previewDriveSyncBinding({
      driveItemId: "folder-1",
      driveItemName: "Repo",
      kind: "folder",
      localPath: folder,
      remoteExists: false,
      activeBindings: [],
      importGitignore: true,
    })).resolves.toMatchObject({
      status: "ready",
      direction: "local_to_remote",
      importedGitignoreRules: ["secrets/**", "*.tmp"],
    })
  })
})

function createBinding(input: { readonly driveItemId: string; readonly localPath: string }): DriveSyncBindingEntryV1 {
  return {
    id: `binding:${input.driveItemId}`,
    schemaVersion: 1,
    driveItemId: input.driveItemId,
    driveItemName: "Bound",
    kind: "folder",
    drivePathHint: null,
    localPath: input.localPath,
    status: "active",
    remoteCursor: null,
    lastSyncedAt: null,
    lastError: null,
    excludeRules: { forced: [".git/**"], defaults: [], importedGitignore: [], user: [] },
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  }
}
