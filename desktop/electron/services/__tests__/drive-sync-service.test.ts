import { EventEmitter } from "node:events"
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
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
import type { DriveSyncWatchFactory } from "../drive-sync-watcher"

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
      deferWatcher: true,
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
      deferWatcher: true,
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
      deferWatcher: true,
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
      deferWatcher: true,
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
      deferWatcher: true,
    })).rejects.toThrow("本地路径已绑定。")
    await expect(service.createBinding({
      driveItemId: "drive-item-3",
      driveItemName: "资料",
      kind: "folder",
      drivePathHint: "/资料",
      localPath: "/users/me/DOCS",
      deferWatcher: true,
    })).rejects.toThrow("本地路径已绑定。")
  })

  it("blocks remote parent and child items from being bound separately", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async (itemId: string) => {
            if (itemId === "remote-docs") return { ...mockDriveItem(itemId), id: itemId, type: "folder", name: "Docs", parentId: null }
            if (itemId === "remote-spec") return { ...mockDriveItem(itemId), id: itemId, type: "file", name: "spec.md", parentId: "remote-docs" }
            return mockDriveItem(itemId)
          }),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "remote spec", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      await service.createBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: path.join(tempDir, "Docs"),
        deferWatcher: true,
      })

      await expect(service.previewBinding({
        driveItemId: "remote-spec",
        driveItemName: "spec.md",
        kind: "file",
        localPath: path.join(tempDir, "spec.md"),
        remoteExists: true,
      })).resolves.toMatchObject({
        status: "blocked",
        reason: "云盘条目位于已同步的云盘文件夹内。",
      })
      await expect(service.createSafeBinding({
        driveItemId: "remote-spec",
        driveItemName: "spec.md",
        kind: "file",
        localPath: path.join(tempDir, "spec.md"),
        direction: "remote_to_local",
      })).rejects.toThrow("云盘条目位于已同步的云盘文件夹内。")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("blocks remote folder bindings that would contain an existing remote binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async (itemId: string) => {
            if (itemId === "remote-docs") return { ...mockDriveItem(itemId), id: itemId, type: "folder", name: "Docs", parentId: null }
            if (itemId === "remote-spec") return { ...mockDriveItem(itemId), id: itemId, type: "file", name: "spec.md", parentId: "remote-docs" }
            return mockDriveItem(itemId)
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      await service.createBinding({
        driveItemId: "remote-spec",
        driveItemName: "spec.md",
        kind: "file",
        localPath: path.join(tempDir, "spec.md"),
        deferWatcher: true,
      })

      await expect(service.previewBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: path.join(tempDir, "Docs"),
        remoteExists: true,
      })).resolves.toMatchObject({
        status: "blocked",
        reason: "云盘条目包含已同步的云盘条目。",
      })
      await expect(service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: path.join(tempDir, "Docs"),
        direction: "remote_to_local",
      })).rejects.toThrow("云盘条目包含已同步的云盘条目。")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
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

  it("redacts drive sync error messages before storing and exposing them", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    await service.recordOperation({
      bindingId: binding.id,
      kind: "download",
      status: "error",
      driveItemId: "drive-item-1",
      relativePath: "secret.md",
      localPath: "/Users/me/docs/secret.md",
      remotePathHint: "/产品文档/secret.md",
      message: "download failed Authorization: Bearer raw-bearer token=plain-secret /Users/me/private/secret.md",
    })
    await service.updateBindingStatus(
      binding.id,
      "error",
      "sync failed api_key=sk-drive-secret-123456 /Users/me/private/secret.md",
    )
    await service.setHealth({
      health: "error",
      lastError: "poll failed Cookie: sid=raw-cookie token=plain-secret",
    })

    const snapshot = await service.getSnapshot()
    const persisted = {
      bindings: await harness.bindings.list(),
      operations: await harness.operations.list(),
      state: await harness.state.getSingleton(),
      snapshot,
    }
    const serialized = JSON.stringify(persisted)

    expect(serialized).not.toContain("raw-bearer")
    expect(serialized).not.toContain("plain-secret")
    expect(serialized).not.toContain("sk-drive-secret-123456")
    expect(serialized).not.toContain("raw-cookie")
    expect(serialized).not.toContain("/Users/me/private/secret.md")
    expect(snapshot.bindings[0]?.lastError).toContain("[redacted]")
    expect(snapshot.operations[0]?.message).toContain("[redacted]")
    await expect(harness.state.getSingleton()).resolves.toMatchObject({
      health: "error",
      lastError: expect.stringContaining("[redacted]"),
    })
  })

  it("updates an existing open conflict for the same path and type", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    const first = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { mtimeMs: 1000 },
      remoteSnapshot: { sequence: "43" },
    })
    const second = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "drive-item-1",
      relativePath: "./spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { mtimeMs: 2000 },
      remoteSnapshot: { sequence: "44" },
    })

    expect(second.id).toBe(first.id)
    await expect(harness.conflicts.list({ bindingId: binding.id })).resolves.toEqual([
      expect.objectContaining({
        id: first.id,
        relativePath: "spec.md",
        localSnapshot: { mtimeMs: 2000 },
        remoteSnapshot: { sequence: "44" },
        status: "open",
      }),
    ])
    await expect(service.getSnapshot()).resolves.toMatchObject({
      summary: { conflictCount: 1 },
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

  it("initializes safe binding remote cursor after the initial sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const listDriveChanges = vi.fn(async (): Promise<DriveChangeListPageDto> => ({
        items: [],
        nextCursor: "42",
        hasMore: false,
        resyncRequired: false,
      }))
      const harness = createHarness({
        accountService: {
          listDriveChanges,
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

      expect(binding).toMatchObject({ status: "active", remoteCursor: "42" })
      expect(listDriveChanges).toHaveBeenCalledWith({ cursor: "latest", limit: 1 })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "42" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects remote file downloads when the local target appears after preview", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const downloadDriveFile = vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote spec", "utf8")
        return { ok: true as const, path: outputPath }
      })
      const harness = createHarness({ accountService: { downloadDriveFile } })
      const service = createDriveSyncService(harness.deps)

      await expect(service.previewBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteExists: true,
      })).resolves.toMatchObject({ status: "ready", direction: "remote_to_local" })
      await writeFile(localPath, "local after preview", "utf8")

      await expect(service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })).rejects.toThrow("本地文件已存在")
      expect(downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.bindings.list()).resolves.toEqual([])
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
            items: [{ id: "drive-item-1", name: "spec.md", type: "file", path: "spec.md", depth: 0, size: "3", mimeType: "text/markdown" }],
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
            items: [
              { id: "nested-item-1", name: "spec.md", type: "file", path: "Archive/spec.md", depth: 1, size: "10", mimeType: "text/markdown" },
              { id: "created-item-1", name: "spec.md", type: "file", path: "spec.md", depth: 0, size: "10", mimeType: "text/markdown" },
            ],
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
      await mkdir(path.join(tempDir, "dist"), { recursive: true })
      await mkdir(path.join(tempDir, "more"), { recursive: true })
      await mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true })
      await mkdir(path.join(tempDir, "notes"), { recursive: true })
      await mkdir(path.join(tempDir, "secrets"), { recursive: true })
      await writeFile(path.join(tempDir, ".gitignore"), "secrets/\n*.tmp\n", "utf8")
      await writeFile(path.join(tempDir, ".git", "config"), "private", "utf8")
      await writeFile(path.join(tempDir, "dist", "app.js"), "compiled", "utf8")
      await writeFile(path.join(tempDir, "draft.tmp"), "temporary", "utf8")
      await writeFile(path.join(tempDir, "error.log"), "log", "utf8")
      await writeFile(path.join(tempDir, "more", "readme.md"), "more", "utf8")
      await writeFile(path.join(tempDir, "node_modules", "pkg", "index.js"), "dependency", "utf8")
      await writeFile(path.join(tempDir, "notes", "spec.md"), "local spec", "utf8")
      await writeFile(path.join(tempDir, "secrets", "token.txt"), "secret", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
          listDriveItemTree: vi.fn(async ({ parentId, offset }: { parentId?: string | null; offset?: number | null }) => {
            if (parentId === null || parentId === undefined) {
              return {
                items: [
                  { id: "nested-docs", name: "Docs", type: "folder", path: "Archive/Docs", depth: 1 },
                  { id: "remote-docs", name: "Docs", type: "folder", path: "Docs", depth: 0 },
                ],
              }
            }
            if (parentId === "remote-docs") {
              if (offset === 1) {
                return { items: [{ id: "remote-more", name: "more", type: "folder" }], nextOffset: 2 }
              }
              if (offset === 2) {
                return { items: [{ id: "remote-gitignore", name: ".gitignore", type: "file" }], nextOffset: null }
              }
              return { items: [{ id: "remote-notes", name: "notes", type: "folder" }], nextOffset: 1 }
            }
            if (parentId === "remote-more") {
              return { items: [{ id: "remote-readme", name: "readme.md", type: "file" }] }
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
        importGitignore: true,
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "remote-docs" })
      expect(binding.excludeRules.defaults).toEqual(expect.arrayContaining(["node_modules/**", "dist/**", "*.log"]))
      const uploadInput = vi.mocked(harness.deps.accountService.uploadDriveLocalItems).mock.calls[0]?.[0]
      const uploadedFolder = uploadInput?.items[0]
      expect(uploadedFolder?.kind).toBe("folder")
      if (!uploadedFolder || uploadedFolder.kind !== "folder") throw new Error("expected folder upload")
      const uploadedRelativePaths = uploadedFolder.files.map((file) => file.relativePath)
      expect(uploadedRelativePaths).toEqual(expect.arrayContaining([
        ".gitignore",
        "more/readme.md",
        "notes/spec.md",
      ]))
      expect(uploadedRelativePaths).not.toEqual(expect.arrayContaining([
        ".git/config",
        "dist/app.js",
        "draft.tmp",
        "error.log",
        "node_modules/pkg/index.js",
        "secrets/token.txt",
      ]))
      expect(binding.excludeRules.importedGitignore).toEqual(["secrets/**", "*.tmp"])
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ relativePath: ".gitignore", remoteItemId: "remote-gitignore", kind: "file" }),
        expect.objectContaining({ relativePath: "empty", remoteItemId: "remote-empty", kind: "folder" }),
        expect.objectContaining({ relativePath: "more", remoteItemId: "remote-more", kind: "folder" }),
        expect.objectContaining({ relativePath: "more/readme.md", remoteItemId: "remote-readme", kind: "file" }),
        expect.objectContaining({ relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ relativePath: "notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      expect(harness.deps.accountService.createDriveFolder).toHaveBeenCalledWith({ parentId: "remote-docs", name: "empty" })
      expect(harness.deps.accountService.createDriveFolder).not.toHaveBeenCalledWith({ parentId: "remote-docs", name: "more" })
      expect(harness.deps.accountService.createDriveFolder).not.toHaveBeenCalledWith({ parentId: "remote-docs", name: "secrets" })
      await expect(harness.baseline.list()).resolves.not.toContainEqual(
        expect.objectContaining({ relativePath: ".git/config" }),
      )
      await expect(harness.baseline.list()).resolves.not.toContainEqual(
        expect.objectContaining({ relativePath: "draft.tmp" }),
      )
      await expect(harness.baseline.list()).resolves.not.toContainEqual(
        expect.objectContaining({ relativePath: "secrets/token.txt" }),
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

  it("downloads a nested remote folder without writing cloud ancestors into the local root", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === "remote-docs") {
              return { items: [
                { id: "remote-assets", name: "assets", type: "folder", path: "Projects/Docs/assets", size: "0" },
                { id: "remote-logo", name: "logo.txt", type: "file", path: "Projects/Docs/assets/logo.txt", size: "4" },
                { id: "remote-spec", name: "spec.md", type: "file", path: "Projects/Docs/spec.md", size: "4" },
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
        drivePathHint: "/Projects/Docs",
        localPath: tempDir,
        direction: "remote_to_local",
      })

      expect(binding).toMatchObject({ status: "active" })
      await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).resolves.toBe("remote-spec")
      await expect(readFile(path.join(tempDir, "assets", "logo.txt"), "utf8")).resolves.toBe("remote-logo")
      await expect(readFile(path.join(tempDir, "Projects", "Docs", "spec.md"), "utf8")).rejects.toThrow()
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ relativePath: "assets", remoteItemId: "remote-assets", kind: "folder" }),
        expect.objectContaining({ relativePath: "assets/logo.txt", remoteItemId: "remote-logo", kind: "file" }),
        expect.objectContaining({ relativePath: "spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects remote folder downloads with case-insensitive local path collisions", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const downloadDriveFile = vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote spec", "utf8")
        return { ok: true as const, path: outputPath }
      })
      const harness = createHarness({
        accountService: {
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === "remote-docs") {
              return { items: [
                { id: "remote-readme-1", name: "Readme.md", type: "file", path: "Docs/Readme.md", size: "11" },
                { id: "remote-readme-2", name: "README.md", type: "file", path: "Docs/README.md", size: "13" },
              ] }
            }
            return { items: [] }
          }),
          downloadDriveFile,
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "remote_to_local",
      })).rejects.toThrow("本地无法区分")
      expect(downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.bindings.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects remote folder downloads when the local target becomes non-empty after preview", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "Docs")
      await mkdir(localPath)
      const downloadDriveFile = vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote spec", "utf8")
        return { ok: true as const, path: outputPath }
      })
      const harness = createHarness({ accountService: { downloadDriveFile } })
      const service = createDriveSyncService(harness.deps)

      await expect(service.previewBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath,
        remoteExists: true,
      })).resolves.toMatchObject({ status: "ready", direction: "remote_to_local" })
      await writeFile(path.join(localPath, "local.md"), "local after preview", "utf8")

      await expect(service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath,
        direction: "remote_to_local",
      })).rejects.toThrow("本地文件夹已有内容")
      expect(downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.bindings.list()).resolves.toEqual([])
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

      expect(binding).toMatchObject({ status: "error", lastError: "disk denied token=[redacted]" })
      await expect(harness.operations.list()).resolves.toMatchObject([
        { bindingId: binding.id, kind: "download", status: "error", message: "disk denied token=[redacted]" },
      ])
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "disk denied token=[redacted]",
      })
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
            items: [{ id: "remote-local", name: "local.md", type: "file", path: "Docs/local.md", depth: 1 }],
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

  it("rescans watcher rename batches and preserves remote file identity", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const oldPath = path.join(tempDir, "old.md")
      const newPath = path.join(tempDir, "new.md")
      await writeFile(oldPath, "same", "utf8")
      let rawEvent: ((eventType: string, filename: string | Buffer | null) => void) | null = null
      const watch: DriveSyncWatchFactory = (_rootPath, _options, listener) => {
        rawEvent = listener
        return { close: vi.fn(), on: vi.fn() } as unknown as ReturnType<DriveSyncWatchFactory>
      }
      const harness = createHarness({ watch })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
      })
      const stats = await lstat(oldPath)
      await harness.baseline.upsert({
        id: `${binding.id}:old.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "old.md",
        kind: "file",
        remoteItemId: "remote-old",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: stats.size,
        localMtimeMs: stats.mtimeMs,
        localHash: await hashDriveSyncFile(oldPath),
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })

      await rename(oldPath, newPath)
      rawEvent?.("rename", "old.md")
      rawEvent?.("rename", "new.md")

      await waitForExpect(() => {
        expect(harness.deps.accountService.moveDriveItem).toHaveBeenCalledWith("remote-old", "drive-root")
        expect(harness.deps.accountService.renameDriveItem).toHaveBeenCalledWith("remote-old", "new.md")
      }, 1000)
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.baseline.get(`${binding.id}:new.md`)).resolves.toMatchObject({
        bindingId: binding.id,
        relativePath: "new.md",
        remoteItemId: "remote-old",
      })
      await expect(harness.baseline.get(`${binding.id}:old.md`)).resolves.toBeNull()
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "move_remote", status: "succeeded", relativePath: "new.md" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rescans watcher folder creations and uploads child files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      let rawEvent: ((eventType: string, filename: string | Buffer | null) => void) | null = null
      const watch: DriveSyncWatchFactory = (_rootPath, _options, listener) => {
        rawEvent = listener
        return { close: vi.fn(), on: vi.fn() } as unknown as ReturnType<DriveSyncWatchFactory>
      }
      const createDriveFolder = vi.fn(async () => ({ id: "remote-project", name: "Project", type: "folder" }))
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const listDriveItemTree = vi.fn(async () => ({
        items: [{ id: "remote-spec", name: "spec.md", type: "file", path: "Docs/Project/spec.md", depth: 2 }],
      }))
      const harness = createHarness({
        watch,
        accountService: {
          createDriveFolder,
          uploadDriveLocalItems,
          listDriveItemTree,
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

      await mkdir(path.join(tempDir, "Project"), { recursive: true })
      await writeFile(path.join(tempDir, "Project", "spec.md"), "spec", "utf8")
      rawEvent?.("rename", "Project")

      await waitForExpect(() => {
        expect(createDriveFolder).toHaveBeenCalledWith({ parentId: "drive-root", name: "Project" })
        expect(uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-project" }))
      }, 1000)
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project", remoteItemId: "remote-project", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      await expect(harness.operations.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "Project" }),
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "Project/spec.md" }),
      ]))
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

  it("keeps the remote cursor and marks the binding as error when resync is required", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [],
            nextCursor: "50",
            hasMore: false,
            resyncRequired: true,
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("远端变更记录已过期")

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        remoteCursor: "41",
        status: "error",
        lastError: "远端变更记录已过期，需要重新建立同步绑定后再同步。",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({
          bindingId: binding.id,
          kind: "resync",
          status: "error",
          message: "远端变更记录已过期，需要重新建立同步绑定后再同步。",
        }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("polls moved remote folders and downloads their descendants", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-project",
              parentId: "drive-root",
              type: "moved",
              itemKind: "folder",
              versionId: null,
              etag: null,
              name: "Project",
              pathHint: "/Docs/Project",
              actor: "user",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          listDriveItemTree: vi.fn(async ({ parentId }: { parentId?: string | null }) => {
            if (parentId === "remote-project") {
              return {
                items: [
                  { id: "remote-notes", name: "notes", type: "folder", path: "Docs/Project/notes" },
                  { id: "remote-spec", name: "spec.md", type: "file", path: "Docs/Project/notes/spec.md" },
                ],
                nextOffset: null,
              }
            }
            return { items: [], nextOffset: null }
          }),
          downloadDriveFile: vi.fn(async ({ itemId, outputPath }: { itemId: string; outputPath: string }) => {
            await writeFile(outputPath, itemId, "utf8")
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

      await expect(readFile(path.join(tempDir, "Project", "notes", "spec.md"), "utf8")).resolves.toBe("remote-spec")
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project", remoteItemId: "remote-project", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project/notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project/notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "43" })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "move_local", status: "succeeded", relativePath: "Project" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("blocks remote downloads through symlinked local folders during polling", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-outside-"))
    try {
      await symlink(outsideDir, path.join(tempDir, "linked"), "dir")
      const downloadDriveFile = vi.fn(async ({ outputPath }: { outputPath: string }) => {
        await writeFile(outputPath, "remote", "utf8")
        return { ok: true as const, path: outputPath }
      })
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
              pathHint: "/Docs/linked/spec.md",
              actor: "user",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          downloadDriveFile,
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步路径包含符号链接，已停止写入。")

      expect(downloadDriveFile).not.toHaveBeenCalled()
      await expect(readFile(path.join(outsideDir, "spec.md"), "utf8")).rejects.toThrow()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        remoteCursor: "41",
        lastError: "同步路径包含符号链接，已停止写入。",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "error", relativePath: "linked/spec.md" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
      await rm(outsideDir, { recursive: true, force: true })
    }
  })

  it("marks bindings as error when local scan fails before remote polling", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    const unreadablePath = path.join(tempDir, "blocked")
    try {
      await mkdir(unreadablePath)
      await chmod(unreadablePath, 0o000)
      const listDriveChanges = vi.fn(async (): Promise<DriveChangeListPageDto> => ({
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
      }))
      const harness = createHarness({
        accountService: {
          listDriveChanges,
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
        remoteCursor: "42",
        deferWatcher: true,
      })

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("本地变更扫描失败")

      expect(listDriveChanges).not.toHaveBeenCalled()
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: expect.stringContaining("本地变更扫描失败"),
      })
    } finally {
      await chmod(unreadablePath, 0o700).catch(() => undefined)
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("does not advance the binding cursor when a remote operation fails", async () => {
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
          downloadDriveFile: vi.fn(async () => {
            throw new Error("disk full")
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("disk full")

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        remoteCursor: "41",
        status: "error",
        lastError: "disk full",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "error" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("polls remote changes in the background and downloads updated files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    let service: ReturnType<typeof createDriveSyncService> | null = null
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "4", "utf8")
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-file",
              parentId: null,
              type: "content_updated",
              versionId: null,
              etag: null,
              name: "spec.md",
              pathHint: "/spec.md",
              actor: "user",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "42", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")

      service.startRemotePolling(5)

      await waitForExpect(async () => {
        await expect(readFile(localPath, "utf8")).resolves.toBe("42")
      })
      await waitForExpect(async () => {
        await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "43" })
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "succeeded" }),
      )
    } finally {
      if (typeof service?.stopRemotePolling === "function") await service.stopRemotePolling()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("does not start overlapping background remote polls", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    let service: ReturnType<typeof createDriveSyncService> | null = null
    let resolvePoll: (page: DriveChangeListPageDto) => void = () => undefined
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(() => new Promise<DriveChangeListPageDto>((resolve) => {
            resolvePoll = resolve
          })),
        },
      })
      service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")

      service.startRemotePolling(5)
      await waitForExpect(() => {
        expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(1)
      })
      await waitForTimeout(25)
      expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(1)

      resolvePoll({ items: [], nextCursor: "43", hasMore: false, resyncRequired: false })

      await waitForExpect(() => {
        expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(2)
      })
    } finally {
      resolvePoll({ items: [], nextCursor: "44", hasMore: false, resyncRequired: false })
      if (typeof service?.stopRemotePolling === "function") await service.stopRemotePolling()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("skips inactive bindings during background remote polling", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    let service: ReturnType<typeof createDriveSyncService> | null = null
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness()
      service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")
      await service.pauseBinding(binding.id)

      service.startRemotePolling(5)
      await waitForTimeout(25)

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
    } finally {
      if (typeof service?.stopRemotePolling === "function") await service.stopRemotePolling()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("continues background remote polling after a transient poll error", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    let service: ReturnType<typeof createDriveSyncService> | null = null
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn()
            .mockRejectedValueOnce(new Error("server unavailable"))
            .mockResolvedValueOnce({ items: [], nextCursor: "43", hasMore: false, resyncRequired: false }),
        },
      })
      service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        remoteCursor: "42",
      })
      await seedFileBaseline(harness, binding.id, localPath, "remote-file")

      service.startRemotePolling(5)

      await waitForExpect(() => {
        expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(2)
      })
      await waitForExpect(async () => {
        await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "43" })
      })
    } finally {
      if (typeof service?.stopRemotePolling === "function") await service.stopRemotePolling()
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

  it("marks bindings as error when the local watcher cannot start without deleting remote roots", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const failingWatch: DriveSyncWatchFactory = () => {
        throw new Error("watch unavailable")
      }
      const harness = createHarness({ watch: failingWatch })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")
      await service.pauseBinding(binding.id)

      await service.resumeBinding(binding.id)

      await waitForExpect(async () => {
        await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
          status: "error",
          lastError: "本地路径监听失败：watch unavailable",
        })
      })
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.operations.list()).resolves.not.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "delete_remote" }),
      )
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

  it("resolves a remote folder conflict without downloading it as a file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "docs")
      await mkdir(localPath, { recursive: true })
      await writeFile(path.join(localPath, "local.md"), "local", "utf8")
      const downloadDriveFile = vi.fn(async () => ({ ok: true as const, path: "" }))
      const harness = createHarness({
        accountService: { downloadDriveFile },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        deferWatcher: true,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-docs",
        relativePath: "docs",
        localPath,
        remotePathHint: "/Docs/docs",
        type: "both_modified",
        remoteSnapshot: {
          change: {
            itemId: "remote-docs",
            itemKind: "folder",
          },
        },
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" })

      expect(downloadDriveFile).not.toHaveBeenCalled()
      const stats = await lstat(localPath)
      expect(stats.isDirectory()).toBe(true)
      await expect(harness.baseline.get(`${binding.id}:docs`)).resolves.toMatchObject({
        bindingId: binding.id,
        relativePath: "docs",
        kind: "folder",
        remoteItemId: "remote-docs",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "succeeded", relativePath: "docs" }),
      )
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

async function waitForExpect(assertion: () => void | Promise<void>, timeoutMs = 250): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await waitForTimeout(5)
    }
  }
  if (lastError) throw lastError
  await assertion()
}

async function waitForTimeout(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

function createHarness(overrides: {
  readonly accountService?: Record<string, unknown>
  readonly auditSink?: AuditSink
  readonly permissionGuard?: PermissionGuard
  readonly watch?: DriveSyncWatchFactory
} = {}) {
  const bindings = createMemoryNamespace<DriveSyncBindingEntryV1>()
  const baseline = createMemoryNamespace<DriveSyncBaselineEntryV1>()
  const operations = createMemoryNamespace<DriveSyncOperationEntryV1>()
  const conflicts = createMemoryNamespace<DriveSyncConflictEntryV1>()
  const state = createMemoryNamespace<DriveSyncStateEntryV1>()
  const accountService = {
    getDriveItem: vi.fn(async (itemId: string) => mockDriveItem(itemId)),
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
      watch: overrides.watch,
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

function mockDriveItem(itemId: string) {
  const lower = itemId.toLowerCase()
  const type: "file" | "folder" = lower.includes("folder") || lower.includes("docs") ? "folder" : "file"
  return {
    id: itemId,
    parentId: null,
    type,
    name: type === "folder" ? "Docs" : "spec.md",
    size: type === "folder" ? "0" : "11",
    mimeType: type === "folder" ? null : "text/markdown",
    storageStatus: "active" as const,
    shared: false,
    activeShareId: null,
    activeShare: null,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  }
}
