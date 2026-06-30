import { EventEmitter } from "node:events"
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { DriveChangeListPageDto } from "@synapse/shared" with { "resolution-mode": "import" }
import type {
  DataNamespace,
  DriveSyncBaselineEntryV1,
  DriveSyncBindingEntryV1,
  DriveSyncConflictEntryV1,
  DriveSyncOperationEntryV1,
  DriveSyncStateEntryV1,
} from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { hashDriveSyncFile } from "../drive-sync-local-snapshot"
import { createDriveSyncService } from "../drive-sync-service"

describe("DriveSyncService", () => {
  it("creates bindings and exposes a sync snapshot", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)

    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
      remoteCursor: "42",
      excludeRules: [".git/**"],
    })

    expect(binding).toMatchObject({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      localPath: "/Users/me/docs",
      status: "active",
      remoteCursor: "42",
      lastError: null,
    })
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [binding],
      conflicts: [],
      operations: [],
      summary: {
        activeBindingCount: 1,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
      },
    })
  })

  it("denies local sync creation through PermissionGuard and records audit", async () => {
    const permissionGuard: PermissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false as const, reason: "denied by test" })),
    }
    const auditSink: AuditSink = {
      record: vi.fn(),
      list: vi.fn(() => []),
      clearForTests: vi.fn(),
    }
    const harness = createHarness({ permissionGuard, auditSink })
    const service = createDriveSyncService(harness.deps)

    await expect(service.createSafeBinding({
      driveItemId: "remote-file",
      driveItemName: "report.md",
      kind: "file",
      localPath: "/Users/me/report.md",
      direction: "remote_to_local",
    })).rejects.toThrow("denied by test")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      actor: { kind: "user" },
      resource: "/Users/me/report.md",
      context: expect.objectContaining({ source: "driveSync.createSafeBinding" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      outcome: "denied",
      resource: "/Users/me/report.md",
      metadata: expect.objectContaining({ reason: "denied by test" }),
    }))
    await expect(harness.bindings.list()).resolves.toEqual([])
  })

  it("exposes binding last errors in snapshots", async () => {
    const service = createDriveSyncService(createHarness().deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    await service.updateBindingStatus(binding.id, "error", "本地文件不存在")

    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [expect.objectContaining({
        id: binding.id,
        status: "error",
        lastError: "本地文件不存在",
      })],
      summary: {
        errorCount: 1,
      },
    })
  })

  it("marks active bindings with missing local roots as snapshot errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing.md")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createBinding({
        driveItemId: "drive-item-1",
        driveItemName: "missing.md",
        kind: "file",
        localPath,
      })
      await harness.baseline.upsert({
        id: `${binding.id}:`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "",
        kind: "file",
        remoteItemId: "drive-item-1",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: 1,
        localMtimeMs: 1,
        localHash: "sha256:old",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })

      await expect(service.getSnapshot()).resolves.toMatchObject({
        bindings: [expect.objectContaining({
          id: binding.id,
          status: "error",
          lastError: "本地路径不存在。",
        })],
        summary: {
          activeBindingCount: 0,
          errorCount: 1,
        },
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("marks active folder bindings with missing local roots as snapshot errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing-folder")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath,
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await expect(service.getSnapshot()).resolves.toMatchObject({
        bindings: [expect.objectContaining({
          id: binding.id,
          status: "error",
          lastError: "本地路径不存在。",
        })],
        summary: {
          activeBindingCount: 0,
          errorCount: 1,
        },
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("marks bindings with deleted root baselines as snapshot errors", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: "/Users/me/spec.md",
    })
    await harness.baseline.upsert({
      id: `${binding.id}:`,
      schemaVersion: 1,
      bindingId: binding.id,
      relativePath: "",
      kind: "file",
      remoteItemId: "drive-item-1",
      remoteVersionId: null,
      remoteEtag: null,
      localSize: 1,
      localMtimeMs: 1,
      localHash: "sha256:old",
      lastSyncedAt: "2026-06-28T00:00:00.000Z",
      deletedAt: "2026-06-29T00:00:00.000Z",
    })

    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [expect.objectContaining({
        id: binding.id,
        status: "error",
        lastError: "同步根对象已删除。",
      })],
      summary: {
        activeBindingCount: 0,
        errorCount: 1,
      },
    })
  })

  it("keeps historical operation errors out of the summary error count", async () => {
    const service = createDriveSyncService(createHarness().deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    await service.recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "error",
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      message: "上传失败",
    })

    await expect(service.getSnapshot()).resolves.toMatchObject({
      operations: [expect.objectContaining({ status: "error" })],
      summary: {
        activeBindingCount: 1,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
      },
    })
  })

  it("rejects duplicate active drive items and local paths", async () => {
    const service = createDriveSyncService(createHarness().deps)
    await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    await expect(service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/other",
    })).rejects.toThrow("云盘条目已绑定。")
    await expect(service.createBinding({
      driveItemId: "drive-item-2",
      driveItemName: "资料",
      kind: "folder",
      drivePathHint: "/资料",
      localPath: "/Users/me/docs",
    })).rejects.toThrow("本地路径已绑定。")
  })

  it("records operations, conflicts, and health for snapshots", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    const operation = await service.recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "running",
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      message: null,
    })
    const conflict = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { mtimeMs: 1000 },
      remoteSnapshot: { sequence: "43" },
    })
    await service.setHealth({ health: "error", lastError: "network unavailable" })

    await expect(service.getSnapshot()).resolves.toMatchObject({
      conflicts: [conflict],
      operations: [operation],
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 1,
        conflictCount: 1,
        errorCount: 0,
      },
    })
    await expect(harness.state.getSingleton()).resolves.toMatchObject({
      health: "error",
      lastError: "network unavailable",
    })
  })

  it("previews and creates a remote file to missing local file binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote spec", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.previewBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteExists: true,
      })).resolves.toMatchObject({ status: "ready", direction: "remote_to_local" })

      const binding = await service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "drive-item-1" })
      await expect(readFile(localPath, "utf8")).resolves.toBe("remote spec")
      const stats = await lstat(localPath)
      await expect(harness.baseline.list()).resolves.toMatchObject([
        {
          bindingId: binding.id,
          relativePath: "",
          remoteItemId: "drive-item-1",
          kind: "file",
          localSize: stats.size,
          localMtimeMs: expect.any(Number),
          localHash: expect.any(String),
        },
      ])
      await expect(harness.operations.list()).resolves.toMatchObject([
        { bindingId: binding.id, kind: "download", status: "succeeded" },
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records local upload failures without rejecting watcher-driven sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "old", "utf8")
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "drive-item-1", name: "spec.md", type: "file", size: "3", mimeType: "text/markdown" }],
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createSafeBinding({
        driveItemId: "new-item",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "local_to_remote",
      })

      await writeFile(localPath, "new", "utf8")
      uploadDriveLocalItems.mockRejectedValueOnce(new Error("目标不是文件夹。"))

      await expect(service.rescanBinding(binding.id)).resolves.toBeUndefined()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "目标不是文件夹。",
      })
      await expect(harness.operations.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "error", message: "目标不是文件夹。" }),
      ]))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a local file to new remote file binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local spec", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "created-item-1", name: "spec.md", type: "file", size: "10", mimeType: "text/markdown" }],
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "new-item",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({ status: "active" })
      expect(harness.deps.accountService.uploadDriveLocalItems).toHaveBeenCalled()
      await expect(harness.baseline.list()).resolves.toMatchObject([
        { bindingId: binding.id, relativePath: "", remoteItemId: "created-item-1", kind: "file" },
      ])
      await expect(harness.operations.list()).resolves.toMatchObject([
        { bindingId: binding.id, kind: "upload", status: "succeeded" },
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("binds an existing local file to an existing remote file without upload or download", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({
            id: "drive-item-1",
            parentId: null,
            type: "file",
            name: "spec.md",
            size: "4",
            mimeType: "text/markdown",
            storageStatus: "active",
            shared: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "bind_existing",
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "drive-item-1" })
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.baseline.list()).resolves.toMatchObject([
        { bindingId: binding.id, relativePath: "", remoteItemId: "drive-item-1", kind: "file" },
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects bind-existing files with different local and remote sizes before creating a binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({
            id: "drive-item-1",
            parentId: null,
            type: "file",
            name: "spec.md",
            size: "999",
            mimeType: "text/markdown",
            storageStatus: "active",
            shared: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "bind_existing",
      })).rejects.toThrow("本地文件与云盘文件大小不一致")
      await expect(harness.bindings.list()).resolves.toEqual([])
      await expect(harness.baseline.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("binds existing local and remote folders when their trees match", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, "notes"), { recursive: true })
      await writeFile(path.join(tempDir, "notes", "spec.md"), "same", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({
            id: "remote-docs",
            parentId: null,
            type: "folder",
            name: "Docs",
            size: "0",
            mimeType: null,
            storageStatus: "active",
            shared: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          })),
          listDriveItemTree: vi.fn(async () => ({
            items: [
              { id: "remote-notes", parentId: "remote-docs", type: "folder", name: "notes", path: "notes", depth: 1, size: "0", mimeType: null, storageStatus: "active", shared: false, createdAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" },
              { id: "remote-spec", parentId: "remote-notes", type: "file", name: "spec.md", path: "notes/spec.md", depth: 2, size: "4", mimeType: "text/markdown", storageStatus: "active", shared: false, createdAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" },
            ],
            total: 2,
            fileCount: 1,
            folderCount: 1,
            hasMore: false,
            nextOffset: null,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "bind_existing",
      })

      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("blocks bind-existing folder previews when local and remote trees differ", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "local-only.md"), "local", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({
            id: "remote-docs",
            parentId: null,
            type: "folder",
            name: "Docs",
            size: "0",
            mimeType: null,
            storageStatus: "active",
            shared: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          })),
          listDriveItemTree: vi.fn(async () => ({
            items: [],
            total: 0,
            fileCount: 0,
            folderCount: 0,
            hasMore: false,
            nextOffset: null,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.previewBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        remoteExists: true,
        directionHint: "bind_existing",
      })).resolves.toMatchObject({
        status: "blocked",
        direction: null,
        reason: expect.stringContaining("local-only.md 仅在本地存在"),
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects bind-existing folders when local and remote trees differ", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "local-only.md"), "local", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({
            id: "remote-docs",
            parentId: null,
            type: "folder",
            name: "Docs",
            size: "0",
            mimeType: null,
            storageStatus: "active",
            shared: false,
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          })),
          listDriveItemTree: vi.fn(async () => ({
            items: [],
            total: 0,
            fileCount: 0,
            folderCount: 0,
            hasMore: false,
            nextOffset: null,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "bind_existing",
      })).rejects.toThrow("本地文件夹与云盘文件夹内容不一致")
      await expect(harness.bindings.list()).resolves.toEqual([])
      await expect(harness.baseline.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("uploads a local folder binding and excludes .git content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, ".git"), { recursive: true })
      await mkdir(path.join(tempDir, "empty"), { recursive: true })
      await mkdir(path.join(tempDir, "notes"), { recursive: true })
      await writeFile(path.join(tempDir, ".git", "config"), "private", "utf8")
      await writeFile(path.join(tempDir, "notes", "spec.md"), "local spec", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === null || parentId === undefined) {
              return { items: [{ id: "remote-docs", name: "Docs", type: "folder" }] }
            }
            if (parentId === "remote-docs") {
              return { items: [{ id: "remote-notes", name: "notes", type: "folder" }] }
            }
            return { items: [{ id: "remote-spec", name: "spec.md", type: "file" }] }
          }),
          createDriveFolder: vi.fn(async ({ name }: { name: string }) => ({ id: `remote-${name}`, name, type: "folder" })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "new-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "remote-docs" })
      expect(harness.deps.accountService.uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({
        items: [expect.objectContaining({
          kind: "folder",
          files: [expect.objectContaining({ relativePath: "notes/spec.md" })],
        })],
      }))
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ relativePath: "empty", remoteItemId: "remote-empty", kind: "folder" }),
        expect.objectContaining({ relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ relativePath: "notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      expect(harness.deps.accountService.createDriveFolder).toHaveBeenCalledWith({ parentId: "remote-docs", name: "empty" })
      await expect(harness.baseline.list()).resolves.not.toContainEqual(
        expect.objectContaining({ relativePath: ".git/config" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("downloads a remote folder binding recursively", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === "remote-docs") {
              return { items: [
                { id: "remote-git", name: ".git", type: "folder", path: "Docs/.git", size: "0" },
                { id: "remote-git-config", name: "config", type: "file", path: "Docs/.git/config", size: "17" },
                { id: "remote-notes", name: "notes", type: "folder", path: "Docs/notes", size: "0" },
                { id: "remote-spec", name: "spec.md", type: "file", path: "Docs/notes/spec.md", size: "11" },
                { id: "remote-readme", name: "readme.md", type: "file", path: "Docs/readme.md", size: "13" },
              ] }
            }
            return { items: [] }
          }),
          downloadDriveFile: vi.fn(async ({ itemId, outputPath }: { itemId: string; outputPath: string }) => {
            await writeFile(outputPath, itemId, "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "remote_to_local",
      })

      expect(binding).toMatchObject({ status: "active" })
      await expect(readFile(path.join(tempDir, "readme.md"), "utf8")).resolves.toBe("remote-readme")
      await expect(readFile(path.join(tempDir, "notes", "spec.md"), "utf8")).resolves.toBe("remote-spec")
      await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).rejects.toThrow()
      await expect(readFile(path.join(tempDir, ".git", "config"), "utf8")).rejects.toThrow()
      expect(harness.deps.accountService.listDriveItemTree).not.toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-git" }))
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ relativePath: "notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("does not delete the remote folder while initializing a remote-to-local folder binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "Docs")
      const harness = createHarness({
        accountService: {
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === "remote-docs") {
              return { items: [{ id: "remote-readme", name: "readme.md", type: "file", path: "Docs/readme.md", size: "13" }] }
            }
            return { items: [] }
          }),
          downloadDriveFile: vi.fn(async ({ itemId, outputPath }: { itemId: string; outputPath: string }) => {
            await writeFile(outputPath, itemId, "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath,
        direction: "remote_to_local",
      })
      await new Promise((resolve) => setTimeout(resolve, 650))

      expect(binding).toMatchObject({ status: "active" })
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "active", lastError: null })
      await expect(readFile(path.join(localPath, "readme.md"), "utf8")).resolves.toBe("remote-readme")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records an error binding and operation when initial transfer fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async () => {
            throw new Error("disk denied token=secret")
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      expect(binding).toMatchObject({ status: "error" })
      await expect(harness.operations.list()).resolves.toMatchObject([
        { bindingId: binding.id, kind: "download", status: "error" },
      ])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("removes baseline entries when a binding is removed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await mkdir(path.dirname(localPath), { recursive: true })
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote spec", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      await service.removeBinding(binding.id)

      await expect(harness.baseline.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rescans missed local changes and uploads them", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "local.md"), "local", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "remote-local", name: "local.md", type: "file" }],
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })

      await service.rescanBinding(binding.id)

      expect(harness.deps.accountService.uploadDriveLocalItems).toHaveBeenCalled()
      await expect(harness.baseline.list()).resolves.toMatchObject([
        { bindingId: binding.id, relativePath: "local.md", remoteItemId: "remote-local" },
      ])
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing folder roots in error when checking local changes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing-folder")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath,
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("本地路径不存在。")

      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing file roots in error when checking local changes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing.md")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "missing.md",
        kind: "file",
        localPath,
        deferWatcher: true,
      })
      await seedFileRootBaseline(harness, binding.id, "remote-file")

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("本地路径不存在。")

      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("polls remote changes, downloads files, and advances the binding cursor", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-spec",
              parentId: "drive-root",
              type: "content_updated",
              versionId: null,
              etag: null,
              name: "spec.md",
              pathHint: "/Docs/spec.md",
              actor: "user",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        remoteCursor: "41",
      })

      await service.pollRemoteChanges(binding.id)

      await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).resolves.toBe("remote")
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "43" })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "succeeded" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing folder roots in error when syncing remote changes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing-folder")
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-spec",
              parentId: "drive-root",
              type: "content_updated",
              versionId: null,
              etag: null,
              name: "spec.md",
              pathHint: "/Docs/spec.md",
              actor: "user",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath,
        remoteCursor: "41",
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("本地路径不存在。")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      await expect(readFile(path.join(localPath, "spec.md"), "utf8")).rejects.toThrow()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing file roots in error when syncing remote changes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing.md")
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "missing.md",
        kind: "file",
        localPath,
        remoteCursor: "41",
        deferWatcher: true,
      })
      await seedFileRootBaseline(harness, binding.id, "remote-file")

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("本地路径不存在。")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing folder roots in error when retrying sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing-folder")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath,
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")
      await service.updateBindingStatus(binding.id, "error", "旧错误")

      await expect(service.resumeBinding(binding.id)).rejects.toThrow("本地路径不存在。")

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps missing file roots in error when retrying sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "missing.md")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "missing.md",
        kind: "file",
        localPath,
        deferWatcher: true,
      })
      await seedFileRootBaseline(harness, binding.id, "remote-file")
      await service.updateBindingStatus(binding.id, "error", "旧错误")

      await expect(service.resumeBinding(binding.id)).rejects.toThrow("本地路径不存在。")

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "本地路径不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps folder bindings in error when the remote root is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const notFound = Object.assign(new Error("NOT_FOUND"), { status: 404 })
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => {
            throw notFound
          }),
          listDriveChanges: vi.fn(async (): Promise<DriveChangeListPageDto> => ({
            items: [],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        remoteCursor: "41",
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("云端同步根目录不存在。")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "云端同步根目录不存在。",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("detects deleted remote root files even when the change cursor has no new records", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const notFound = Object.assign(new Error("NOT_FOUND"), { status: 404 })
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => {
            throw notFound
          }),
          listDriveChanges: vi.fn(async (): Promise<DriveChangeListPageDto> => ({
            items: [],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")

      await service.pollRemoteChanges(binding.id)

      await expect(readFile(localPath, "utf8")).rejects.toThrow()
      const trashEntries = await readdir(path.join(tempDir, ".synapse-sync-trash"))
      expect(trashEntries.some((entry) => entry.endsWith("-spec.md"))).toBe(true)
      await expect(harness.baseline.get(`${binding.id}:`)).resolves.toMatchObject({
        bindingId: binding.id,
        relativePath: "",
        remoteItemId: "remote-file",
        deletedAt: "2026-06-28T00:00:00.000Z",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "delete_local", status: "succeeded", relativePath: "" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records a conflict instead of deleting locally modified root files when remote root is missing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "before", "utf8")
      const notFound = Object.assign(new Error("HTTP 404 NOT_FOUND"), { status: 404 })
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => {
            throw notFound
          }),
          listDriveChanges: vi.fn(async (): Promise<DriveChangeListPageDto> => ({
            items: [],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")
      await writeFile(localPath, "local after baseline", "utf8")

      await service.pollRemoteChanges(binding.id)

      await expect(readFile(localPath, "utf8")).resolves.toBe("local after baseline")
      await expect(harness.conflicts.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, relativePath: "", type: "delete_vs_modify", status: "open" }),
      )
      await expect(harness.operations.list()).resolves.not.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "delete_local", status: "succeeded" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("does not treat non-404 root file lookup errors as remote deletes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => {
            throw Object.assign(new Error("server unavailable"), { status: 500 })
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("server unavailable")
      await expect(readFile(localPath, "utf8")).resolves.toBe("same")
      await expect(harness.operations.list()).resolves.not.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "delete_local" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records conflicts from simultaneous local and remote changes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })
      await harness.baseline.upsert({
        id: `${binding.id}:spec.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "spec.md",
        kind: "file",
        remoteItemId: "remote-spec",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: null,
        localMtimeMs: null,
        localHash: "sha256:before",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })

      await writeFile(path.join(tempDir, "spec.md"), "local after baseline", "utf8")
      await harness.deps.accountService.listDriveChanges.mockResolvedValueOnce({
        items: [{
          id: "change-1",
          sequence: "43",
          itemId: "remote-spec",
          parentId: "drive-root",
          type: "content_updated",
          versionId: null,
          etag: null,
          name: "spec.md",
          pathHint: "/Docs/spec.md",
          actor: "user",
          occurredAt: "2026-06-28T00:00:00.000Z",
        }],
        nextCursor: "43",
        hasMore: false,
        resyncRequired: false,
      })
      await service.pollRemoteChanges(binding.id)

      await expect(harness.conflicts.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, relativePath: "spec.md", type: "both_modified", status: "open" }),
      )
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("resolves a conflict by keeping the remote file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-spec",
        relativePath: "spec.md",
        localPath: path.join(tempDir, "spec.md"),
        remotePathHint: "/Docs/spec.md",
        type: "both_modified",
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" })

      await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).resolves.toBe("remote")
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "resolved", resolution: "keep_remote" })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "active" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("checks and audits local writes before applying remote conflict resolution", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const permissionGuard: PermissionGuard = {
        registerPolicy: vi.fn(),
        check: vi.fn(async () => ({ allowed: true as const })),
      }
      const auditSink: AuditSink = {
        record: vi.fn(),
        list: vi.fn(() => []),
        clearForTests: vi.fn(),
      }
      const harness = createHarness({
        auditSink,
        permissionGuard,
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-spec",
        relativePath: "spec.md",
        localPath,
        remotePathHint: "/Docs/spec.md",
        type: "both_modified",
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" })

      expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write.outside-userdata",
        actor: { kind: "user" },
        resource: localPath,
        context: expect.objectContaining({
          source: "driveSync.executeOperation",
          operationKind: "download",
        }),
      }))
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write.outside-userdata",
        outcome: "allowed",
        resource: localPath,
        metadata: expect.objectContaining({ source: "driveSync.executeOperation" }),
      }))
      await expect(readFile(localPath, "utf8")).resolves.toBe("remote")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("resolves a conflict by keeping the local file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-spec",
        relativePath: "spec.md",
        localPath: path.join(tempDir, "spec.md"),
        remotePathHint: "/Docs/spec.md",
        type: "both_modified",
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_local" })

      expect(harness.deps.accountService.uploadDriveLocalItems).toHaveBeenCalled()
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "resolved", resolution: "keep_local" })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})

async function seedFileBaseline(
  harness: ReturnType<typeof createHarness>,
  bindingId: string,
  localPath: string,
  remoteItemId: string,
): Promise<void> {
  const stats = await lstat(localPath)
  await harness.baseline.upsert({
    id: `${bindingId}:`,
    schemaVersion: 1,
    bindingId,
    relativePath: "",
    kind: "file",
    remoteItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: stats.size,
    localMtimeMs: stats.mtimeMs,
    localHash: await hashDriveSyncFile(localPath),
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  })
}

async function seedFileRootBaseline(
  harness: ReturnType<typeof createHarness>,
  bindingId: string,
  remoteItemId: string,
): Promise<void> {
  await harness.baseline.upsert({
    id: `${bindingId}:`,
    schemaVersion: 1,
    bindingId,
    relativePath: "",
    kind: "file",
    remoteItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: 1,
    localMtimeMs: 1,
    localHash: "sha256:old",
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  })
}

async function seedFolderRootBaseline(
  harness: ReturnType<typeof createHarness>,
  bindingId: string,
  remoteItemId: string,
): Promise<void> {
  await harness.baseline.upsert({
    id: `${bindingId}:`,
    schemaVersion: 1,
    bindingId,
    relativePath: "",
    kind: "folder",
    remoteItemId,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: null,
    localMtimeMs: null,
    localHash: null,
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  })
}

function createHarness(overrides: {
  readonly accountService?: Record<string, unknown>
  readonly auditSink?: AuditSink
  readonly permissionGuard?: PermissionGuard
} = {}) {
  const bindings = createMemoryNamespace<DriveSyncBindingEntryV1>()
  const baseline = createMemoryNamespace<DriveSyncBaselineEntryV1>()
  const operations = createMemoryNamespace<DriveSyncOperationEntryV1>()
  const conflicts = createMemoryNamespace<DriveSyncConflictEntryV1>()
  const state = createMemoryNamespace<DriveSyncStateEntryV1>()
  const accountService = {
    getDriveItem: vi.fn(),
    downloadDriveFile: vi.fn(async () => ({ ok: true as const, path: "" })),
    downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const, path: "" })),
    uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
    createDriveFolder: vi.fn(async () => ({ id: "folder-1", name: "Folder", type: "folder" })),
    renameDriveItem: vi.fn(),
    moveDriveItem: vi.fn(),
    deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    listDriveChanges: vi.fn(async (): Promise<DriveChangeListPageDto> => ({ items: [], nextCursor: null, hasMore: false, resyncRequired: false })),
    listDriveItemTree: vi.fn(async () => ({ items: [] })),
    ensureDriveFolderPath: vi.fn(),
    ...overrides.accountService,
  }
  let idCounter = 0
  return {
    bindings,
    baseline,
    operations,
    conflicts,
    state,
    deps: {
      bindings,
      baseline,
      operations,
      conflicts,
      state,
      accountService,
      auditSink: overrides.auditSink,
      permissionGuard: overrides.permissionGuard,
      now: () => new Date("2026-06-28T00:00:00.000Z"),
      createId: (prefix: string) => `${prefix}-${++idCounter}`,
    },
  }
}

function createMemoryNamespace<T extends Record<string, unknown>>() {
  const events = new EventEmitter()
  let singleton: T | null = null
  const records = new Map<string, T>()
  const namespace: DataNamespace<T> & { records: Map<string, T> } = {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite",
    records,
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list(filter?: Partial<T>) {
      const entries = Array.from(records.values())
      if (!filter) return entries
      return entries.filter((entry) =>
        Object.entries(filter).every(([key, value]) => entry[key as keyof T] === value),
      )
    },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
