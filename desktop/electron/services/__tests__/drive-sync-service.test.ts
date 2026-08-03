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
import { createDriveSyncService, type DriveSyncAccountService } from "../drive-sync-service"
import type { DriveSyncWatchFactory } from "../drive-sync-watcher"

describe("DriveSyncService", () => {
  it("creates bindings and exposes a sync snapshot", async () => {
    const harness = createHarness({
      watch: () => ({ close: vi.fn(), on: vi.fn() }) as unknown as ReturnType<DriveSyncWatchFactory>,
    })
    const service = createDriveSyncService(harness.deps)

    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      drivePathHint: "/产品文档",
      kind: "folder",
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

  it("isolates bindings and health snapshots by account", async () => {
    let ownerUserId: string | null = "user-1"
    const harness = createHarness({
      accountService: {
        getState: () => ownerUserId === null
          ? { status: "anonymous" as const, connectivity: "offline" as const }
          : ({
              status: "authenticated" as const,
              connectivity: "online" as const,
              profile: {
                user: { id: ownerUserId, email: `${ownerUserId}@example.com`, handle: ownerUserId, status: "active" as const },
                syncedAt: "2026-06-28T00:00:00.000Z",
              },
            }),
      },
    })
    const service = createDriveSyncService(harness.deps)
    const first = await service.createBinding({
      driveItemId: "drive-user-1",
      driveItemName: "User 1",
      kind: "folder",
      localPath: os.tmpdir(),
      deferWatcher: true,
    })
    await service.setHealth({ health: "error", lastError: "user one error" })

    ownerUserId = "user-2"
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [],
      health: { status: "idle", lastError: null },
    })
    const second = await service.createBinding({
      driveItemId: "drive-user-2",
      driveItemName: "User 2",
      kind: "folder",
      localPath: os.tmpdir(),
      deferWatcher: true,
    })
    await service.setHealth({ health: "retrying", lastError: "user two retry" })
    await expect(service.getSnapshot()).resolves.toMatchObject({ bindings: [{ id: second.id }] })

    ownerUserId = "user-1"
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [{ id: first.id }],
      health: { status: "error", lastError: "user one error" },
    })

    ownerUserId = null
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [{ id: second.id }],
      health: { status: "retrying", readOnly: true, lastError: "user two retry" },
    })
  })

  it("rejects new bindings while logged out or offline", async () => {
    let accountState: "logged_out" | "offline" = "logged_out"
    const harness = createHarness({
      accountService: {
        getState: () => accountState === "logged_out"
          ? { status: "anonymous" as const, connectivity: "offline" as const }
          : {
              status: "authenticated" as const,
              connectivity: "offline" as const,
              profile: {
                user: { id: "user-1", email: "user-1@example.com", handle: "user-1", status: "active" as const },
                syncedAt: "2026-06-28T00:00:00.000Z",
              },
            },
      },
    })
    const service = createDriveSyncService(harness.deps)

    await expect(service.createBinding({
      driveItemId: "drive-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: os.tmpdir(),
      deferWatcher: true,
    })).rejects.toThrow("请先登录")

    accountState = "offline"
    await expect(service.createBinding({
      driveItemId: "drive-1",
      driveItemName: "Docs",
      kind: "folder",
      localPath: os.tmpdir(),
      deferWatcher: true,
    })).rejects.toThrow("离线状态")
    await expect(harness.bindings.list()).resolves.toEqual([])
  })

  it("clears v1 sync metadata without touching local or remote content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-migration-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "keep", "utf8")
      const harness = createHarness()
      await harness.bindings.upsert({
        id: "legacy-binding",
        schemaVersion: 1,
        driveItemId: "legacy-remote",
        driveItemName: "spec.md",
        kind: "file",
        drivePathHint: null,
        localPath,
        status: "active",
        remoteCursor: "1",
        lastSyncedAt: null,
        lastError: null,
        excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] },
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
      })
      await harness.state.setSingleton({
        schemaVersion: 1,
        health: "error",
        lastCursor: "1",
        lastStartedAt: null,
        lastStoppedAt: null,
        lastError: "legacy",
        updatedAt: "2026-06-28T00:00:00.000Z",
      })

      const service = createDriveSyncService(harness.deps)
      await expect(service.getSnapshot()).resolves.toMatchObject({ bindings: [], conflicts: [], operations: [] })
      await expect(readFile(localPath, "utf8")).resolves.toBe("keep")
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("recovers an uploaded root file and commits its real remote id after restart", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-recovery-"))
    const stagingRootPath = path.join(tempDir, "staging")
    try {
      const localPath = path.join(tempDir, "spec.md")
      const snapshotPath = path.join(stagingRootPath, "binding-1", "upload-1", "content")
      await mkdir(path.dirname(snapshotPath), { recursive: true })
      await writeFile(localPath, "uploaded", "utf8")
      await writeFile(snapshotPath, "uploaded", "utf8")
      const snapshotHash = await hashDriveSyncFile(snapshotPath)
      const snapshotStats = await lstat(snapshotPath)
      const harness = createHarness({
        stagingRootPath,
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "uploaded", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "local-placeholder",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        initialDirection: "local_to_remote",
        initialStatus: "initializing",
        deferWatcher: true,
      })
      await harness.operations.upsert({
        id: "upload-1",
        schemaVersion: 2,
        bindingId: binding.id,
        kind: "upload",
        status: "running",
        driveItemId: "remote-real",
        relativePath: "",
        localPath,
        remotePathHint: null,
        message: "正在确认上传结果。",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        startedAt: "2026-06-28T00:00:00.000Z",
        completedAt: null,
        attemptCount: 0,
        nextRetryAt: null,
        completedBytes: snapshotStats.size,
        totalBytes: snapshotStats.size,
        remoteItemKind: "file",
        source: "initialization",
        snapshotPath,
        snapshotHash,
        snapshotSize: snapshotStats.size,
        snapshotMtimeMs: snapshotStats.mtimeMs,
      })

      await service.startLocalWatcher()

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "active",
        driveItemId: "remote-real",
      })
      await expect(harness.baseline.get(`${binding.id}:`)).resolves.toMatchObject({
        remoteItemId: "remote-real",
        localHash: snapshotHash,
      })
      await expect(harness.operations.get("upload-1")).resolves.toMatchObject({ status: "succeeded" })
      await expect(lstat(snapshotPath)).rejects.toThrow()
      await service.stopLocalWatcher()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("recovers a completed upload response loss by path and snapshot hash", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-response-loss-"))
    const stagingRootPath = path.join(tempDir, "staging")
    try {
      const localPath = path.join(tempDir, "spec.md")
      const snapshotPath = path.join(stagingRootPath, "drive-sync-binding-1", "upload-1", "content")
      await mkdir(path.dirname(snapshotPath), { recursive: true })
      await writeFile(localPath, "uploaded", "utf8")
      await writeFile(snapshotPath, "uploaded", "utf8")
      const snapshotHash = await hashDriveSyncFile(snapshotPath)
      const snapshotStats = await lstat(snapshotPath)
      const harness = createHarness({
        stagingRootPath,
        accountService: {
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "remote-recovered", parentId: "remote-parent", name: "spec.md", type: "file", path: "spec.md", size: "8", depth: 0 }],
            nextOffset: null,
          })),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "uploaded", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "local-placeholder",
        remoteParentId: "remote-parent",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        deferWatcher: true,
      })
      await harness.operations.upsert({
        id: "upload-1",
        schemaVersion: 2,
        bindingId: binding.id,
        kind: "upload",
        status: "running",
        driveItemId: null,
        relativePath: "",
        localPath,
        remotePathHint: null,
        message: "等待确认上传结果。",
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        startedAt: "2026-06-28T00:00:00.000Z",
        completedAt: null,
        snapshotPath,
        snapshotHash,
        snapshotSize: snapshotStats.size,
        snapshotMtimeMs: snapshotStats.mtimeMs,
        completedBytes: snapshotStats.size,
        totalBytes: snapshotStats.size,
      })

      await service.startLocalWatcher()

      await expect(harness.operations.get("upload-1")).resolves.toMatchObject({ status: "succeeded", driveItemId: "remote-recovered" })
      await expect(harness.baseline.get(`${binding.id}:`)).resolves.toMatchObject({ remoteItemId: "remote-recovered", localHash: snapshotHash })
      expect(harness.deps.accountService.uploadDriveSyncFile).not.toHaveBeenCalled()
      await expect(lstat(snapshotPath)).rejects.toThrow()
      await service.stopLocalWatcher()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("fully reconciles a migrated initialization before marking it active", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-migrated-initialization-"))
    try {
      const listDriveChanges = vi.fn(async ({ cursor }: { readonly cursor?: string | null } = {}) => ({
        items: [],
        nextCursor: cursor === "latest" ? "40" : cursor ?? "40",
        hasMore: false,
        resyncRequired: false,
      }))
      const harness = createHarness({
        accountService: {
          listDriveChanges,
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "remote-cloud", name: "cloud.md", type: "file", path: "/Docs/cloud.md", size: "6" }],
            nextOffset: null,
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
        initialDirection: "remote_to_local",
        initialStatus: "initializing",
        initialPhase: "reconcile",
        deferWatcher: true,
      })

      await service.startLocalWatcher()

      await expect(readFile(path.join(tempDir, "cloud.md"), "utf8")).resolves.toBe("remote")
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "active",
        initialPhase: null,
        initialCursor: null,
        remoteCursor: "40",
      })
      expect(listDriveChanges).toHaveBeenCalledWith({ cursor: "latest", limit: 1 })
      expect(listDriveChanges).toHaveBeenCalledWith(expect.objectContaining({ cursor: "40", rootItemId: "drive-root" }))
      await service.stopLocalWatcher()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("starts local watchers for active bindings on service startup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const close = vi.fn()
      const on = vi.fn()
      const watch: DriveSyncWatchFactory = vi.fn(() => ({ close, on }))
      const harness = createHarness({ watch })
      const service = createDriveSyncService(harness.deps)

      await service.createBinding({
        driveItemId: "drive-item-1",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        deferWatcher: true,
      })

      expect(watch).not.toHaveBeenCalled()
      await service.startLocalWatcher()

      expect(watch).toHaveBeenCalledWith(
        tempDir,
        { persistent: false, recursive: true },
        expect.any(Function),
      )
      await service.stopLocalWatcher()
      expect(close).toHaveBeenCalled()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rescans active bindings on local watcher startup and uploads changes missed while closed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "local.md")
      await writeFile(localPath, "before", "utf8")
      const uploadDriveSyncFile = vi.fn(async () => mockDriveItem("remote-local"))
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "same", "utf8")
            return { ok: true as const, path: outputPath }
          }),
          uploadDriveSyncFile,
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
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")
      await harness.baseline.upsert({
        id: `${binding.id}:local.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "local.md",
        kind: "file",
        remoteItemId: "remote-local",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: 6,
        localMtimeMs: 1,
        localHash: "sha256:old",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })
      await writeFile(localPath, "after", "utf8")

      await service.startLocalWatcher()

      expect(uploadDriveSyncFile).toHaveBeenCalled()
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "local.md" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
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

  it("does not require read permission after remote-to-local safe binding write authorization", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "report.md")
      const permissionGuard: PermissionGuard = {
        registerPolicy: vi.fn(),
        check: vi.fn(async (input: Parameters<PermissionGuard["check"]>[0]) => {
          if (input.action === "fs.write.outside-userdata") return { allowed: true as const }
          return { allowed: false as const, reason: "read denied by test" }
        }),
      }
      const auditSink: AuditSink = {
        record: vi.fn(),
        list: vi.fn(() => []),
        clearForTests: vi.fn(),
      }
      const harness = createHarness({
        permissionGuard,
        auditSink,
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { readonly outputPath: string }) => {
            await writeFile(outputPath, "remote report", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "remote-file",
        driveItemName: "report.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "remote-file" })
      expect(permissionGuard.check).toHaveBeenCalledTimes(1)
      expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write.outside-userdata",
        actor: { kind: "user" },
        resource: localPath,
        context: expect.objectContaining({
          source: "driveSync.createSafeBinding",
          direction: "remote_to_local",
        }),
      }))
      expect(auditSink.record).toHaveBeenCalledTimes(1)
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write.outside-userdata",
        outcome: "allowed",
        metadata: expect.objectContaining({
          source: "driveSync.createSafeBinding",
          direction: "remote_to_local",
        }),
      }))
      await expect(readFile(localPath, "utf8")).resolves.toBe("remote report")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("exposes binding last errors in snapshots", async () => {
    const service = createDriveSyncService(createHarness().deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: os.tmpdir(),
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

  it("reuses retry-wait operations for the same local path", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
      deferWatcher: true,
    })

    const first = await service.recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "retry_wait",
      driveItemId: null,
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: null,
      message: "稍后重试",
    })
    const second = await service.recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "retry_wait",
      driveItemId: null,
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: null,
      message: "再次重试",
    })
    const running = await service.recordOperation({
      bindingId: binding.id,
      kind: "upload",
      status: "running",
      driveItemId: null,
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: null,
      message: null,
    })

    expect(second.id).toBe(first.id)
    expect(running.id).toBe(first.id)
    await expect(harness.operations.list({ bindingId: binding.id })).resolves.toMatchObject([
      {
        id: first.id,
        status: "running",
        relativePath: "spec.md",
        startedAt: "2026-06-28T00:00:00.000Z",
      },
    ])
  })

  it("updates binding last synced time after a successful operation", async () => {
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
      status: "succeeded",
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      message: null,
    })

    await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
      lastSyncedAt: "2026-06-28T00:00:00.000Z",
    })
    await expect(service.getSnapshot()).resolves.toMatchObject({
      bindings: [expect.objectContaining({
        id: binding.id,
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
      })],
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

  it("rejects symlink aliases that resolve to an already bound local folder", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const targetFolder = path.join(tempDir, "Docs")
      const aliasFolder = path.join(tempDir, "Docs Alias")
      await mkdir(targetFolder)
      await symlink(targetFolder, aliasFolder, "dir")

      const service = createDriveSyncService(createHarness({
        accountService: {
          getDriveItem: vi.fn(async (itemId: string) => ({ ...mockDriveItem(itemId), type: "folder" })),
        },
      }).deps)
      await service.createBinding({
        driveItemId: "drive-item-1",
        driveItemName: "产品文档",
        kind: "folder",
        drivePathHint: "/产品文档",
        localPath: targetFolder,
        deferWatcher: true,
      })

      await expect(service.previewBinding({
        driveItemId: "drive-item-2",
        driveItemName: "资料",
        kind: "folder",
        drivePathHint: "/资料",
        localPath: aliasFolder,
        remoteExists: true,
        directionHint: "bind_existing",
      })).resolves.toMatchObject({
        status: "blocked",
        reason: "本地路径已绑定。",
      })
      await expect(service.createSafeBinding({
        driveItemId: "drive-item-2",
        driveItemName: "资料",
        kind: "folder",
        drivePathHint: "/资料",
        localPath: aliasFolder,
        direction: "bind_existing",
      })).rejects.toThrow("本地路径已绑定。")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
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
    const harness = createHarness({
      watch: () => ({ close: vi.fn(), on: vi.fn() }) as unknown as ReturnType<DriveSyncWatchFactory>,
    })
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
    expect(operation).toMatchObject({ kind: "download" })
    const conflict = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "drive-item-1",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { change: { localKind: "file", relativePath: "spec.md", localSize: 12 } },
      remoteSnapshot: { change: { itemKind: "file", pathHint: "/产品文档/spec.md", versionId: "v2", size: "12" } },
    })
    expect(conflict).toMatchObject({
      localSummary: "本地：文件，路径 spec.md，大小 12 B",
      remoteSummary: "云端：文件，路径 /产品文档/spec.md，大小 12 B，版本 v2",
    })
    await service.setHealth({ health: "error", lastError: "network unavailable" })

    await expect(service.getSnapshot()).resolves.toMatchObject({
      conflicts: [conflict],
      operations: [operation],
      health: {
        status: "error",
        lastError: "network unavailable",
      },
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

  it("keeps recent operations for each binding in snapshots", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const targetBinding = await service.createBinding({
      driveItemId: "target-drive-item",
      driveItemName: "Target Docs",
      kind: "folder",
      localPath: "/Users/me/target-docs",
      deferWatcher: true,
    })
    const noisyBinding = await service.createBinding({
      driveItemId: "noisy-drive-item",
      driveItemName: "Noisy Docs",
      kind: "folder",
      localPath: "/Users/me/noisy-docs",
      deferWatcher: true,
    })
    const createOperation = (
      id: string,
      bindingId: string,
      relativePath: string,
      updatedAt: string,
    ): DriveSyncOperationEntryV1 => ({
      id,
      schemaVersion: 1,
      bindingId,
      kind: "download",
      status: "succeeded",
      driveItemId: null,
      relativePath,
      localPath: null,
      remotePathHint: null,
      message: null,
      createdAt: updatedAt,
      updatedAt,
      startedAt: null,
      completedAt: updatedAt,
    })

    await harness.operations.upsert(createOperation(
      "target-operation",
      targetBinding.id,
      "target.md",
      "2026-06-28T00:00:00.000Z",
    ))
    for (let index = 1; index <= 20; index += 1) {
      const updatedAt = new Date(Date.UTC(2026, 5, 28, 0, index, 0)).toISOString()
      await harness.operations.upsert(createOperation(
        `noisy-operation-${index}`,
        noisyBinding.id,
        `noisy-${index}.md`,
        updatedAt,
      ))
    }

    const snapshot = await service.getSnapshot()

    expect(snapshot.operations).toHaveLength(21)
    expect(snapshot.operations.filter((operation) => operation.bindingId === targetBinding.id)).toEqual([
      expect.objectContaining({
        id: "target-operation",
        relativePath: "target.md",
      }),
    ])
  })

  it("prunes old terminal operations after recording new history", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
    })

    for (let index = 1; index <= 105; index += 1) {
      await service.recordOperation({
        bindingId: binding.id,
        kind: "download",
        status: "succeeded",
        driveItemId: `drive-item-${index}`,
        relativePath: `history-${index}.md`,
        localPath: `/Users/me/docs/history-${index}.md`,
        remotePathHint: `/产品文档/history-${index}.md`,
        message: null,
      })
    }

    await expect(harness.operations.list({ bindingId: binding.id })).resolves.toHaveLength(100)
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
        localSnapshot: expect.objectContaining({ exists: true, mtimeMs: 2000 }),
        remoteSnapshot: expect.objectContaining({ exists: true, sequence: "44" }),
        status: "open",
      }),
    ])
    await expect(service.getSnapshot()).resolves.toMatchObject({
      summary: { conflictCount: 1 },
    })
  })

  it("exposes keep-both only for file-backed conflicts", async () => {
    const harness = createHarness()
    const service = createDriveSyncService(harness.deps)
    const binding = await service.createBinding({
      driveItemId: "drive-item-1",
      driveItemName: "产品文档",
      kind: "folder",
      drivePathHint: "/产品文档",
      localPath: "/Users/me/docs",
      deferWatcher: true,
    })

    const fileConflict = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "remote-spec",
      relativePath: "spec.md",
      localPath: "/Users/me/docs/spec.md",
      remotePathHint: "/产品文档/spec.md",
      type: "both_modified",
      localSnapshot: { change: { localKind: "file" } },
      remoteSnapshot: { baseline: { kind: "file" } },
    })
    const folderConflict = await service.recordConflict({
      bindingId: binding.id,
      driveItemId: "remote-docs",
      relativePath: "docs",
      localPath: "/Users/me/docs/docs",
      remotePathHint: "/产品文档/docs",
      type: "both_modified",
      localSnapshot: { change: { localKind: "folder" } },
      remoteSnapshot: { baseline: { kind: "folder" } },
    })

    expect(fileConflict.availableActions).toEqual(["keep_local", "keep_remote", "keep_both", "skip"])
    expect(folderConflict.availableActions).toEqual(["keep_local", "keep_remote", "skip"])
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

  it("exposes running operations while sync work is in progress", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const download = createDeferred<{ readonly ok: true; readonly path: string }>()
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
            await download.promise
            await writeFile(outputPath, "remote spec", "utf8")
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
      const pollPromise = service.pollRemoteChanges(binding.id)

      await waitForExpect(() => {
        expect(harness.deps.accountService.downloadDriveFile).toHaveBeenCalled()
      })
      await expect(service.getSnapshot()).resolves.toMatchObject({
        operations: [expect.objectContaining({ kind: "download", status: "running" })],
        summary: { runningOperationCount: 1 },
      })

      download.resolve({ ok: true, path: path.join(tempDir, "spec.md") })
      await pollPromise

      const snapshot = await service.getSnapshot()
      expect(snapshot.summary.runningOperationCount).toBe(0)
      expect(snapshot.operations).toHaveLength(1)
      expect(snapshot.operations[0]).toMatchObject({ kind: "download", status: "succeeded" })
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

  it("replays remote changes that happen during initial remote file sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      let downloadCount = 0
      const listDriveChanges = vi.fn(async (input: { readonly cursor?: string | null }) => {
        if (input.cursor === "latest") {
          return { items: [], nextCursor: "100", hasMore: false, resyncRequired: false }
        }
        if (input.cursor === "100") {
          return {
            items: [{
              id: "change-101",
              sequence: "101",
              itemId: "remote-file",
              parentId: null,
              type: "content_updated",
              versionId: null,
              etag: null,
              name: "spec.md",
              pathHint: "/spec.md",
              actor: "web",
              occurredAt: "2026-06-28T00:00:01.000Z",
            }],
            nextCursor: "101",
            hasMore: false,
            resyncRequired: false,
          }
        }
        return { items: [], nextCursor: input.cursor ?? null, hasMore: false, resyncRequired: false }
      })
      const harness = createHarness({
        accountService: {
          listDriveChanges,
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            downloadCount += 1
            await writeFile(outputPath, downloadCount === 1 ? "initial" : "remote update", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      await expect(readFile(localPath, "utf8")).resolves.toBe("remote update")
      expect(listDriveChanges).toHaveBeenCalledWith({ cursor: "latest", limit: 1 })
      expect(listDriveChanges).toHaveBeenCalledWith(expect.objectContaining({ cursor: "100", rootItemId: "remote-file" }))
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "active", remoteCursor: "101" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records local upload failures without rejecting watcher-driven sync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "old", "utf8")
      const uploadDriveSyncFile = vi.fn(async (input: Parameters<DriveSyncAccountService["uploadDriveSyncFile"]>[0]) =>
        mockDriveItem(input.expectedItemId ?? "drive-item-1"))
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile,
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "old", "utf8")
            return { ok: true as const, path: outputPath }
          }),
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
      uploadDriveSyncFile.mockRejectedValueOnce(new Error("目标不是文件夹。"))

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("目标不是文件夹。")
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

  it("uploads local-origin files into the selected Drive parent", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "spec", "utf8")
      let uploadedPath: string | null = null
      const uploadDriveSyncFile = vi.fn(async (input: Parameters<DriveSyncAccountService["uploadDriveSyncFile"]>[0]) => {
        uploadedPath = input.path
        expect(input.path).not.toBe(localPath)
        await expect(readFile(input.path, "utf8")).resolves.toBe("spec")
        return mockDriveItem("uploaded-spec")
      })
      const listDriveItemTree = vi.fn(async ({ parentId }: { readonly parentId?: string | null }) => ({
        items: parentId === "folder-1"
          ? [{ id: "uploaded-spec", name: "spec.md", type: "file", path: "Docs/spec.md", depth: 1, size: "4", mimeType: "text/markdown" }]
          : [],
      }))
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile,
          listDriveItemTree,
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "local-placeholder",
        driveItemName: "spec.md",
        kind: "file",
        drivePathHint: "/Docs/spec.md",
        targetParentId: "folder-1",
        localPath,
        direction: "local_to_remote",
      })

      expect(uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({
        parentId: "folder-1",
        path: uploadedPath,
        name: "spec.md",
      }))
      expect(listDriveItemTree).not.toHaveBeenCalled()
      expect(binding).toMatchObject({ driveItemId: "uploaded-spec" })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ drivePathHint: "/Docs/spec.md" })
      expect(uploadedPath).not.toBeNull()
      await expect(lstat(uploadedPath!)).rejects.toThrow()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects local folder uploads that contain symlinks before creating a binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "spec", "utf8")
      await symlink(path.join(tempDir, "spec.md"), path.join(tempDir, "link.md"))
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "new-folder",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "local_to_remote",
      })).rejects.toThrow("本地文件夹包含无法同步的符号链接")
      await expect(harness.bindings.list()).resolves.toEqual([])
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
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
          uploadDriveSyncFile: vi.fn(async () => mockDriveItem("created-item-1")),
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
      expect(harness.deps.accountService.uploadDriveSyncFile).toHaveBeenCalled()
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
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "same", "utf8")
            return { ok: true as const, path: outputPath }
          }),
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
      expect(harness.deps.accountService.downloadDriveFile).toHaveBeenCalledTimes(1)
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
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "same", "utf8")
            return { ok: true as const, path: outputPath }
          }),
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

  it("rejects bind-existing files with the same size but different content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "same", "utf8")
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => ({ ...mockDriveItem("drive-item-1"), size: "4" })),
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "diff", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "bind_existing",
      })).rejects.toThrow("内容不一致")
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
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "same", "utf8")
            return { ok: true as const, path: outputPath }
          }),
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
      expect(harness.deps.accountService.downloadDriveFile).toHaveBeenCalledTimes(1)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("ignores excluded remote-only paths when binding existing folders", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, "notes"), { recursive: true })
      await writeFile(path.join(tempDir, "notes", "spec.md"), "same", "utf8")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { outputPath: string }) => {
            await writeFile(outputPath, "same", "utf8")
            return { ok: true as const, path: outputPath }
          }),
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
              { id: "remote-node-modules", parentId: "remote-docs", type: "folder", name: "node_modules", path: "node_modules", depth: 1, size: "0", mimeType: null, storageStatus: "active", shared: false, createdAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" },
              { id: "remote-package", parentId: "remote-node-modules", type: "file", name: "package.json", path: "node_modules/package.json", depth: 2, size: "2", mimeType: "application/json", storageStatus: "active", shared: false, createdAt: "2026-06-28T00:00:00.000Z", updatedAt: "2026-06-28T00:00:00.000Z" },
            ],
            total: 4,
            fileCount: 2,
            folderCount: 2,
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
      })).resolves.toMatchObject({ status: "ready", direction: "bind_existing" })

      const binding = await service.createSafeBinding({
        driveItemId: "remote-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        direction: "bind_existing",
      })

      const baselines = await harness.baseline.list()
      expect(baselines).toHaveLength(3)
      expect(baselines).toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "", remoteItemId: "remote-docs", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "notes", remoteItemId: "remote-notes", kind: "folder" }),
        expect.objectContaining({ bindingId: binding.id, relativePath: "notes/spec.md", remoteItemId: "remote-spec", kind: "file" }),
      ]))
      expect(baselines).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ relativePath: expect.stringContaining("node_modules") }),
      ]))
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
      const uploadDriveLocalItems = vi.fn(async (_input: Parameters<DriveSyncAccountService["uploadDriveLocalItems"]>[0]) => ({ completed: 1, failed: 0, skipped: 0 }))
      let rootListCalls = 0
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          listDriveItemTree: vi.fn(async ({ parentId, offset }: { parentId?: string | null; offset?: number | null }) => {
            if (parentId === null || parentId === undefined) {
              rootListCalls += 1
              if (rootListCalls === 1) return { items: [], nextOffset: null }
              return {
                items: [
                  { id: "nested-docs", name: "Docs", type: "folder", path: "Archive/Docs", depth: 1, size: "0" },
                  { id: "remote-docs", name: "Docs", type: "folder", path: "Docs", depth: 0, size: "0" },
                ],
              }
            }
            if (parentId === "remote-docs") {
              if (offset === 3) {
                return {
                  items: [
                    { id: "remote-gitignore", name: ".gitignore", type: "file", path: "Docs/.gitignore", depth: 1, size: "9" },
                    { id: "remote-spec", name: "spec.md", type: "file", path: "Docs/notes/spec.md", depth: 2, size: "4" },
                  ],
                  nextOffset: null,
                }
              }
              return {
                items: [
                  { id: "remote-notes", name: "notes", type: "folder", path: "Docs/notes", depth: 1, size: "0" },
                  { id: "remote-more", name: "more", type: "folder", path: "Docs/more", depth: 1, size: "0" },
                  { id: "remote-readme", name: "readme.md", type: "file", path: "Docs/more/readme.md", depth: 2, size: "6" },
                ],
                nextOffset: 3,
              }
            }
            return { items: [] }
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
      expect(binding.excludeRules.defaults).toEqual(expect.arrayContaining(["node_modules/", "dist/", "*.log"]))
      const uploadInput = uploadDriveLocalItems.mock.calls[0]?.[0]
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
      expect(binding.excludeRules.importedGitignore).toEqual(["secrets/", "*.tmp"])
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
      expect(harness.deps.accountService.listDriveItemTree).not.toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-more" }))
      expect(harness.deps.accountService.listDriveItemTree).not.toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-notes" }))
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

  it("preserves local-to-remote root names and paths with surrounding spaces", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, " Report ")
      await mkdir(localPath, { recursive: true })
      await writeFile(path.join(localPath, "note.md"), "note", "utf8")
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      let rootListCalls = 0
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          listDriveItemTree: vi.fn(async ({ parentId }: { readonly parentId?: string | null }) => {
            if (parentId === null || parentId === undefined) {
              rootListCalls += 1
              if (rootListCalls === 1) return { items: [], nextOffset: null }
              return { items: [{ id: "remote-report", name: " Report ", type: "folder", path: " Report ", depth: 0 }] }
            }
            return { items: [{ id: "remote-note", name: "note.md", type: "file", path: " Report /note.md", depth: 1 }] }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: "new-folder",
        driveItemName: " Report ",
        kind: "folder",
        localPath,
        direction: "local_to_remote",
      })

      expect(uploadDriveLocalItems).toHaveBeenCalledWith(expect.objectContaining({
        parentId: null,
        items: [expect.objectContaining({ kind: "folder", folderName: " Report " })],
      }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
      expect(binding).toMatchObject({ localPath, driveItemName: " Report ", driveItemId: "remote-report" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("rejects local folder uploads when the target parent already contains the same folder", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await writeFile(path.join(tempDir, "local.md"), "local", "utf8")
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const createDriveFolder = vi.fn(async ({ name }: { readonly name: string }) => ({ id: `remote-${name}`, name, type: "folder" }))
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          createDriveFolder,
          listDriveItemTree: vi.fn(async ({ parentId }: { readonly parentId?: string | null }) => {
            if (parentId === "target-parent") {
              return {
                items: [
                  { id: "existing-docs", parentId: "target-parent", name: "Docs", type: "folder", path: "Docs", depth: 0 },
                ],
                nextOffset: null,
              }
            }
            return { items: [], nextOffset: null }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: "new-docs",
        driveItemName: "Docs",
        kind: "folder",
        localPath: tempDir,
        targetParentId: "target-parent",
        direction: "local_to_remote",
      })).rejects.toThrow("目标云盘位置已存在同名文件夹")
      expect(uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(createDriveFolder).not.toHaveBeenCalled()
      await expect(harness.bindings.list()).resolves.toEqual([])
      await expect(harness.baseline.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records uploaded folder baselines by recursive remote paths instead of duplicate names", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, "docs"), { recursive: true })
      await writeFile(path.join(tempDir, "README.md"), "root", "utf8")
      await writeFile(path.join(tempDir, "docs", "README.md"), "nested", "utf8")
      let rootListCalls = 0
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
          listDriveItemTree: vi.fn(async ({ parentId }: { readonly parentId?: string | null }) => {
            if (parentId === null || parentId === undefined) {
              rootListCalls += 1
              if (rootListCalls === 1) return { items: [], nextOffset: null }
              return { items: [{ id: "remote-docs", name: "Docs", type: "folder", path: "Docs", depth: 0, size: "0" }] }
            }
            if (parentId === "remote-docs") {
              return { items: [
                { id: "remote-root-readme", name: "README.md", type: "file", path: "Docs/README.md", depth: 1, size: "4" },
                { id: "remote-docs-folder", name: "docs", type: "folder", path: "Docs/docs", depth: 1, size: "0" },
                { id: "remote-nested-readme", name: "README.md", type: "file", path: "Docs/docs/README.md", depth: 2, size: "6" },
              ] }
            }
            return { items: [] }
          }),
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
      await expect(harness.baseline.get(`${binding.id}:README.md`)).resolves.toMatchObject({
        relativePath: "README.md",
        remoteItemId: "remote-root-readme",
      })
      await expect(harness.baseline.get(`${binding.id}:docs/README.md`)).resolves.toMatchObject({
        relativePath: "docs/README.md",
        remoteItemId: "remote-nested-readme",
      })
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

  it("rolls back local-to-remote bindings when the initial upload fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile: vi.fn(async () => { throw new Error("quota exceeded") }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: `local:${localPath}`,
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "local_to_remote",
      })).rejects.toThrow("quota exceeded")

      await expect(harness.bindings.list()).resolves.toEqual([])
      await expect(harness.operations.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("moves a partially uploaded initialization folder to Drive trash", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-partial-folder-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const uploadDriveLocalItems = vi.fn(async (
        _input: Parameters<DriveSyncAccountService["uploadDriveLocalItems"]>[0],
        options: Parameters<DriveSyncAccountService["uploadDriveLocalItems"]>[1],
      ) => {
        options?.onFolderPrepared?.({ id: "partial-root", created: true })
        throw new Error("child failed")
      })
      const harness = createHarness({ accountService: { uploadDriveLocalItems } })
      const service = createDriveSyncService(harness.deps)

      await expect(service.createSafeBinding({
        driveItemId: `local:${tempDir}`,
        driveItemName: path.basename(tempDir),
        kind: "folder",
        localPath: tempDir,
        direction: "local_to_remote",
      })).rejects.toThrow("child failed")

      expect(harness.deps.accountService.deleteDriveItem).toHaveBeenCalledWith("partial-root")
      await expect(harness.bindings.list()).resolves.toEqual([])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps the real remote root when partial initialization cleanup fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-partial-folder-"))
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const uploadDriveLocalItems = vi.fn(async (
        _input: Parameters<DriveSyncAccountService["uploadDriveLocalItems"]>[0],
        options: Parameters<DriveSyncAccountService["uploadDriveLocalItems"]>[1],
      ) => {
        options?.onFolderPrepared?.({ id: "partial-root", created: true })
        return { completed: 1, failed: 1, skipped: 0, message: "child failed" }
      })
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          deleteDriveItem: vi.fn(async () => { throw new Error("cleanup unavailable") }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: `local:${tempDir}`,
        driveItemName: path.basename(tempDir),
        kind: "folder",
        localPath: tempDir,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({
        driveItemId: "partial-root",
        status: "error",
        lastError: expect.stringContaining("已保留同步绑定"),
      })
      await expect(harness.bindings.list()).resolves.toHaveLength(1)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps edits during initial local file upload pending instead of marking them synced", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "uploaded bytes", "utf8")
      const uploadedHash = await hashDriveSyncFile(localPath)
      let uploadedPath: string | null = null
      const uploadDriveSyncFile = vi.fn(async (input: Parameters<DriveSyncAccountService["uploadDriveSyncFile"]>[0]) => {
        uploadedPath = input.path
        expect(input.path).not.toBe(localPath)
        await expect(readFile(input.path, "utf8")).resolves.toBe("uploaded bytes")
        await writeFile(localPath, "edited during upload", "utf8")
        return mockDriveItem("remote-file-1")
      })
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile,
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "remote-file-1", name: "spec.md", type: "file", path: "spec.md", depth: 0 }],
            nextOffset: null,
          })),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: `local:${localPath}`,
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({ status: "active", driveItemId: "remote-file-1" })
      expect(uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({
        name: "spec.md", path: uploadedPath,
      }))
      await expect(readFile(localPath, "utf8")).resolves.toBe("edited during upload")
      await expect(harness.baseline.list()).resolves.toContainEqual(expect.objectContaining({
        bindingId: binding.id,
        relativePath: "",
        remoteItemId: "remote-file-1",
        localHash: uploadedHash,
      }))
      await expect(harness.operations.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "" }),
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "retry_wait", relativePath: "" }),
      ]))
      expect(uploadedPath).not.toBeNull()
      await expect(lstat(uploadedPath!)).rejects.toThrow()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps local-to-remote file bindings recoverable when finalization fails after upload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile: vi.fn(async () => mockDriveItem("remote-file-1")),
          listDriveItemTree: vi.fn(async () => ({
            items: [{ id: "remote-file-1", name: "spec.md", type: "file", path: "spec.md", depth: 0 }],
            nextOffset: null,
          })),
        },
      })
      vi.spyOn(harness.baseline, "upsert").mockRejectedValueOnce(new Error("baseline unavailable"))
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: `local:${localPath}`,
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({
        status: "error",
        driveItemId: "remote-file-1",
        lastError: "baseline unavailable",
      })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        driveItemId: "remote-file-1",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({
          bindingId: binding.id,
          kind: "upload",
          status: "error",
          driveItemId: "remote-file-1",
          message: "baseline unavailable",
        }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps local-to-remote folder bindings recoverable when empty folder finalization fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, "empty"))
      const harness = createHarness({
        accountService: {
          createDriveFolder: vi.fn(async ({ name }: { readonly name: string }) => {
            if (name === "Project") return { id: "remote-root-1", name, type: "folder" }
            throw new Error("folder create failed")
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const binding = await service.createSafeBinding({
        driveItemId: `local:${tempDir}`,
        driveItemName: "Project",
        kind: "folder",
        localPath: tempDir,
        direction: "local_to_remote",
      })

      expect(binding).toMatchObject({
        status: "error",
        driveItemId: "remote-root-1",
        lastError: "folder create failed",
      })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        driveItemId: "remote-root-1",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({
          bindingId: binding.id,
          kind: "upload",
          status: "error",
          driveItemId: "remote-root-1",
          message: "folder create failed",
        }),
      )
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
          uploadDriveSyncFile: vi.fn(async () => mockDriveItem("remote-local")),
          listDriveItemTree: vi.fn(async () => ({ items: [] })),
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

      await expect(service.rescanBinding(binding.id)).resolves.toBeUndefined()

      expect(harness.deps.accountService.uploadDriveSyncFile).toHaveBeenCalled()
      await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "local.md", remoteItemId: "remote-local" }),
      ]))
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
      emitRawEvent(rawEvent, "rename", "old.md")
      emitRawEvent(rawEvent, "rename", "new.md")

      await waitForExpect(() => {
        expect(harness.deps.accountService.moveDriveItem).toHaveBeenCalledWith("remote-old", "drive-root")
        expect(harness.deps.accountService.renameDriveItem).toHaveBeenCalledWith("remote-old", "new.md")
      }, 1000)
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await waitForExpect(async () => {
        await expect(harness.operations.list()).resolves.toContainEqual(
          expect.objectContaining({ bindingId: binding.id, kind: "move_remote", status: "succeeded", relativePath: "new.md" }),
        )
        await expect(harness.baseline.get(`${binding.id}:new.md`)).resolves.toMatchObject({
          bindingId: binding.id,
          relativePath: "new.md",
          remoteItemId: "remote-old",
        })
        await expect(harness.baseline.get(`${binding.id}:old.md`)).resolves.toBeNull()
      }, 3000)
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
      const uploadDriveSyncFile = vi.fn(async () => mockDriveItem("remote-spec"))
      const listDriveItemTree = vi.fn(async () => ({
        items: [{ id: "remote-spec", name: "spec.md", type: "file", path: "Docs/Project/spec.md", depth: 1 }],
      }))
      const harness = createHarness({
        watch,
        accountService: {
          createDriveFolder,
          uploadDriveSyncFile,
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
      emitRawEvent(rawEvent, "rename", "Project")

      await waitForExpect(async () => {
        expect(createDriveFolder).toHaveBeenCalledWith({ parentId: "drive-root", name: "Project" })
        expect(uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-project" }))
        await expect(harness.baseline.list()).resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({ bindingId: binding.id, relativePath: "Project", remoteItemId: "remote-project", kind: "folder" }),
          expect.objectContaining({ bindingId: binding.id, relativePath: "Project/spec.md", remoteItemId: "remote-spec", kind: "file" }),
        ]))
        await expect(harness.operations.list()).resolves.toEqual(expect.arrayContaining([
          expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "Project" }),
          expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "Project/spec.md" }),
        ]))
      }, 1000)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("stops watcher folder creation batches after a parent upload fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      let rawEvent: ((eventType: string, filename: string | Buffer | null) => void) | null = null
      const watch: DriveSyncWatchFactory = (_rootPath, _options, listener) => {
        rawEvent = listener
        return { close: vi.fn(), on: vi.fn() } as unknown as ReturnType<DriveSyncWatchFactory>
      }
      const createDriveFolder = vi.fn(async () => {
        throw new Error("父目录创建失败。")
      })
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const harness = createHarness({
        watch,
        accountService: {
          createDriveFolder,
          uploadDriveLocalItems,
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
      emitRawEvent(rawEvent, "rename", "Project")

      await waitForExpect(async () => {
        expect(createDriveFolder).toHaveBeenCalledWith({ parentId: "drive-root", name: "Project" })
        await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
          status: "error",
          lastError: "父目录创建失败。",
        })
      }, 1000)
      expect(uploadDriveLocalItems).not.toHaveBeenCalled()
      await expect(harness.baseline.list()).resolves.toEqual([])
      const operations = await harness.operations.list()
      expect(operations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          bindingId: binding.id,
          kind: "upload",
          status: "error",
          relativePath: "Project",
          message: "父目录创建失败。",
        }),
      ]))
      expect(operations).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ bindingId: binding.id, relativePath: "Project/spec.md" }),
      ]))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps transient upload failures retryable without terminating the binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    const stagingRootPath = path.join(tempDir, "staging")
    try {
      await writeFile(path.join(tempDir, "spec.md"), "local", "utf8")
      const transient = Object.assign(new Error("rate limited"), { status: 429 })
      const harness = createHarness({
        stagingRootPath,
        accountService: {
          uploadDriveSyncFile: vi.fn(async () => { throw transient }),
        },
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

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("rate limited")

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "active", lastError: null })
      const retryOperation = (await harness.operations.list()).find((operation) => operation.relativePath === "spec.md")
      expect(retryOperation).toEqual(expect.objectContaining({
        bindingId: binding.id,
        relativePath: "spec.md",
        status: "retry_wait",
        attemptCount: 1,
        nextRetryAt: expect.any(String),
        snapshotPath: expect.any(String),
        snapshotHash: expect.any(String),
      }))
      await expect(lstat(retryOperation!.snapshotPath!)).resolves.toMatchObject({ size: 5 })
      await expect(service.getSnapshot()).resolves.toMatchObject({
        health: { status: "retrying", lastError: "rate limited" },
        summary: { retryWaitingOperationCount: 1, errorCount: 0 },
      })
      await service.stopLocalWatcher()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("runs a full reconciliation when an exclude rule re-includes content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-rules-"))
    try {
      await writeFile(path.join(tempDir, "draft.tmp"), "local", "utf8")
      const harness = createHarness()
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        excludeRules: ["*.tmp"],
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await service.updateExcludeRules({ id: binding.id, defaults: [], importedGitignore: [], user: [] })

      expect(harness.deps.accountService.uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({ name: "draft.tmp" }))
      await expect(harness.baseline.list()).resolves.toContainEqual(expect.objectContaining({
        bindingId: binding.id,
        relativePath: "draft.tmp",
        remoteItemId: "remote-upload",
      }))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a root deletion conflict when a local folder root is missing", async () => {
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

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("同步根对象缺失")

      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
      await expect(harness.conflicts.list()).resolves.toContainEqual(expect.objectContaining({
        bindingId: binding.id,
        relativePath: "",
        type: "delete_vs_modify",
        status: "open",
      }))
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a root deletion conflict when a local file root is missing", async () => {
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

      await expect(service.rescanBinding(binding.id)).rejects.toThrow("同步根对象缺失")

      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      expect(harness.deps.accountService.uploadDriveLocalItems).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
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

  it("serializes concurrent sync actions for the same binding", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const changes = createDeferred<DriveChangeListPageDto>()
      const listDriveChanges = vi.fn(() => changes.promise)
      const harness = createHarness({ accountService: { listDriveChanges } })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "drive-root",
        driveItemName: "Docs",
        kind: "folder",
        drivePathHint: "/Docs",
        localPath: tempDir,
        remoteCursor: "41",
      })

      const firstPoll = service.pollRemoteChanges(binding.id)
      await waitForExpect(() => {
        expect(listDriveChanges).toHaveBeenCalledTimes(1)
      })

      const rescan = service.rescanBinding(binding.id)
      await Promise.resolve()
      expect(listDriveChanges).toHaveBeenCalledTimes(1)

      changes.resolve({ items: [], nextCursor: "41", hasMore: false, resyncRequired: false })
      await expect(Promise.all([firstPoll, rescan])).resolves.toEqual([undefined, undefined])
      await expect(service.pollRemoteChanges(binding.id)).resolves.toBeUndefined()
      expect(listDriveChanges).toHaveBeenCalledTimes(4)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("cancels an active download before pausing and leaves it retryable", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const downloadStarted = createDeferred<void>()
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-spec",
              parentId: "drive-root",
              type: "created",
              versionId: null,
              etag: null,
              name: "spec.md",
              pathHint: "/Docs/spec.md",
              actor: "web",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
            nextCursor: "43",
            hasMore: false,
            resyncRequired: false,
          })),
          downloadDriveFile: vi.fn(async ({ signal }: { readonly signal?: AbortSignal }) => {
            downloadStarted.resolve()
            return new Promise<never>((_resolve, reject) => {
              signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
            })
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
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      const polling = service.pollRemoteChanges(binding.id)
      await downloadStarted.promise
      const paused = service.pauseBinding(binding.id)

      await expect(polling).rejects.toMatchObject({ name: "DriveSyncWorkCancelledError" })
      await expect(paused).resolves.toMatchObject({ status: "paused" })
      await expect(harness.operations.list()).resolves.toContainEqual(expect.objectContaining({
        bindingId: binding.id,
        kind: "download",
        status: "retry_wait",
      }))
      await expect(lstat(localPath)).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("queues sync actions while a safe binding is still initializing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      const download = createDeferred<{ readonly ok: true; readonly path: string }>()
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { readonly outputPath: string }) => {
            await download.promise
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)

      const creating = service.createSafeBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        direction: "remote_to_local",
      })

      await waitForExpect(() => {
        expect(harness.deps.accountService.downloadDriveFile).toHaveBeenCalled()
      })
      const [binding] = await harness.bindings.list()
      expect(binding).toBeDefined()
      const rescan = service.rescanBinding(binding!.id)
      expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(1)
      expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledWith({ cursor: "latest", limit: 1 })

      download.resolve({ ok: true, path: localPath })
      await expect(creating).resolves.toMatchObject({ status: "active" })
      await expect(rescan).resolves.toBeUndefined()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("performs a full reconciliation when the remote cursor requires resync", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async ({ cursor }: { cursor?: string | null }) => ({
            items: [],
            nextCursor: "50",
            hasMore: false,
            resyncRequired: cursor === "41",
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

      await expect(service.pollRemoteChanges(binding.id)).resolves.toBeUndefined()

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        remoteCursor: "50",
        status: "active",
        lastError: null,
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({
          bindingId: binding.id,
          kind: "resync",
          status: "succeeded",
          message: null,
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
              pathHint: "/Archive/Project",
              currentPathHint: "/Docs/Project",
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

  it("ignores watcher events for files written by a remote folder download", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      let rawEvent: ((eventType: string, filename: string | Buffer | null) => void) | null = null
      const watch: DriveSyncWatchFactory = (_rootPath, _options, listener) => {
        rawEvent = listener
        return { close: vi.fn(), on: vi.fn() } as unknown as ReturnType<DriveSyncWatchFactory>
      }
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const harness = createHarness({
        watch,
        accountService: {
          uploadDriveLocalItems,
          listDriveChanges: vi.fn()
            .mockResolvedValueOnce({
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
            })
            .mockResolvedValue({
              items: [],
              nextCursor: "43",
              hasMore: false,
              resyncRequired: false,
            }),
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
      emitRawEvent(rawEvent, "change", "Project/notes/spec.md")
      await waitForTimeout(650)

      expect(uploadDriveLocalItems).not.toHaveBeenCalled()
      await expect(harness.operations.list()).resolves.not.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", relativePath: "Project/notes/spec.md" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("updates the remote root name and path after the synced drive folder renames", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const listDriveChanges = vi.fn()
        .mockResolvedValueOnce({
          items: [{
            id: "change-1",
            sequence: "42",
            itemId: "drive-root",
            parentId: "archive",
            type: "moved",
            itemKind: "folder",
            versionId: null,
            etag: null,
            name: "Archive",
            pathHint: "/Archive",
            actor: "user",
            occurredAt: "2026-06-28T00:00:00.000Z",
          }],
          nextCursor: "42",
          hasMore: true,
          resyncRequired: false,
        })
        .mockResolvedValueOnce({
          items: [{
            id: "change-2",
            sequence: "43",
            itemId: "remote-spec",
            parentId: "drive-root",
            type: "content_updated",
            versionId: null,
            etag: null,
            name: "spec.md",
            pathHint: "/Archive/spec.md",
            actor: "user",
            occurredAt: "2026-06-28T00:00:01.000Z",
          }],
          nextCursor: "43",
          hasMore: false,
          resyncRequired: false,
        })
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
        remoteCursor: "41",
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await service.pollRemoteChanges(binding.id)

      expect(listDriveChanges).toHaveBeenNthCalledWith(1, {
        cursor: "41",
        limit: 100,
        rootItemId: "drive-root",
        rootPathHint: "/Docs",
      })
      expect(listDriveChanges).toHaveBeenNthCalledWith(2, {
        cursor: "42",
        limit: 100,
        rootItemId: "drive-root",
        rootPathHint: "/Archive",
      })
      await expect(readFile(path.join(tempDir, "spec.md"), "utf8")).resolves.toBe("remote")
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        driveItemName: "Archive",
        drivePathHint: "/Archive",
        remoteCursor: "43",
      })
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
            .mockRejectedValueOnce(Object.assign(new Error("server unavailable"), { code: "ECONNRESET" }))
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
        expect(harness.deps.accountService.listDriveChanges.mock.calls.length).toBeGreaterThanOrEqual(2)
      })
      await waitForExpect(async () => {
        await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ remoteCursor: "43" })
      })
    } finally {
      if (typeof service?.stopRemotePolling === "function") await service.stopRemotePolling()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a conflict for missing local folder roots before syncing remote changes", async () => {
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步根对象缺失")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      await expect(readFile(path.join(localPath, "spec.md"), "utf8")).rejects.toThrow()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a conflict for missing local file roots before syncing remote changes", async () => {
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步根对象缺失")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps a missing folder root in conflict when retrying sync", async () => {
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

      await expect(service.resumeBinding(binding.id)).resolves.toMatchObject({ status: "conflict" })

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "conflict",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("uploads changes made while a binding was paused before reporting it synced", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-resume-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "before", "utf8")
      const harness = createHarness()
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
      const beforeStats = await lstat(localPath)
      await harness.baseline.upsert({
        id: `${binding.id}:spec.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "spec.md",
        kind: "file",
        remoteItemId: "remote-spec",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: beforeStats.size,
        localMtimeMs: beforeStats.mtimeMs,
        localHash: await hashDriveSyncFile(localPath),
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })
      await service.pauseBinding(binding.id)
      await writeFile(localPath, "changed while paused", "utf8")

      await expect(service.resumeBinding(binding.id)).resolves.toMatchObject({ status: "active" })

      expect(harness.deps.accountService.uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({
        expectedItemId: "remote-spec",
        name: "spec.md",
      }))
      await expect(harness.baseline.get(`${binding.id}:spec.md`)).resolves.toMatchObject({
        localHash: await hashDriveSyncFile(localPath),
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

  it("keeps a missing file root in conflict when retrying sync", async () => {
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

      await expect(service.resumeBinding(binding.id)).resolves.toMatchObject({ status: "conflict" })

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "conflict",
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("creates a conflict when the remote folder root is missing", async () => {
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步根对象缺失")

      expect(harness.deps.accountService.listDriveChanges).not.toHaveBeenCalled()
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("requires confirmation when a remote root file is missing", async () => {
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步根对象缺失")

      await expect(readFile(localPath, "utf8")).resolves.toBe("same")
      await expect(harness.conflicts.list()).resolves.toContainEqual(expect.objectContaining({
        bindingId: binding.id,
        relativePath: "",
        type: "delete_vs_modify",
        status: "open",
      }))
      expect(harness.deps.accountService.deleteDriveItem).not.toHaveBeenCalled()
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

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("同步根对象缺失")

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

  it("stops remote polling work when account authentication is unavailable", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness({
        accountService: {
          listDriveChanges: vi.fn(async () => {
            throw new Error("账号未登录。")
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
        deferWatcher: true,
      })
      await seedFolderRootBaseline(harness, binding.id, "drive-root")

      await expect(service.pollRemoteChanges(binding.id)).rejects.toThrow("账号未登录。")

      expect(harness.deps.accountService.listDriveChanges).toHaveBeenCalledTimes(1)
      expect(harness.deps.accountService.downloadDriveFile).not.toHaveBeenCalled()
      await expect(harness.operations.list()).resolves.toEqual([])
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

  it("ignores the next matching remote change after a local upload succeeds", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "first", "utf8")
      let changePollCount = 0
      const harness = createHarness({
        accountService: {
          uploadDriveSyncFile: vi.fn(async () => mockDriveItem("remote-spec")),
          listDriveItemTree: vi.fn(async () => ({ items: [] })),
          listDriveChanges: vi.fn(async () => {
            changePollCount += 1
            if (changePollCount === 1) {
              return { items: [], nextCursor: "41", hasMore: false, resyncRequired: false }
            }
            if (changePollCount > 2) {
              return { items: [], nextCursor: "43", hasMore: false, resyncRequired: false }
            }
            return {
              items: [{
              id: "change-1",
              sequence: "43",
              itemId: "remote-spec",
              parentId: "drive-root",
              type: "created",
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
            }
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

      await service.rescanBinding(binding.id)
      await writeFile(localPath, "second", "utf8")
      await service.pollRemoteChanges(binding.id)

      await expect(harness.conflicts.list()).resolves.toEqual([])
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        remoteCursor: "43",
        status: "active",
      })
      await expect(readFile(localPath, "utf8")).resolves.toBe("second")
      await expect(harness.operations.list()).resolves.not.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records a conflict instead of uploading when a matching remote change is still unpolled", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "first", "utf8")
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          listDriveChanges: vi.fn(async () => ({
            items: [{
              id: "change-remote-first",
              sequence: "43",
              itemId: "remote-spec",
              parentId: "drive-root",
              type: "content_updated",
              versionId: "remote-version",
              etag: "remote-etag",
              name: "spec.md",
              pathHint: "/Docs/spec.md",
              actor: "web",
              occurredAt: "2026-06-28T00:00:00.000Z",
            }],
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
      const stats = await lstat(localPath)
      await harness.baseline.upsert({
        id: `${binding.id}:spec.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "spec.md",
        kind: "file",
        remoteItemId: "remote-spec",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: stats.size,
        localMtimeMs: stats.mtimeMs,
        localHash: await hashDriveSyncFile(localPath),
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })
      await writeFile(localPath, "local second", "utf8")

      await service.rescanBinding(binding.id)

      expect(uploadDriveLocalItems).not.toHaveBeenCalled()
      await expect(harness.conflicts.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, relativePath: "spec.md", type: "both_modified", status: "open" }),
      )
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        remoteCursor: "43",
        status: "conflict",
      })
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

  it("finishes initialization after its last conflict is resolved", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-initial-conflict-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async ({ outputPath }: { readonly outputPath: string }) => {
            await writeFile(outputPath, "remote", "utf8")
            return { ok: true as const, path: outputPath }
          }),
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-file",
        driveItemName: "spec.md",
        kind: "file",
        localPath,
        initialDirection: "remote_to_local",
        initialStatus: "initializing",
        initialPhase: "replay",
        initialCursor: "40",
        deferWatcher: true,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-file",
        relativePath: "",
        localPath,
        remotePathHint: "/spec.md",
        type: "both_modified",
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" })

      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "active",
        initialPhase: null,
        initialCursor: null,
        remoteCursor: null,
      })
      await expect(readFile(localPath, "utf8")).resolves.toBe("remote")
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("resolves keep-both conflicts without overwriting existing local copies", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      await writeFile(path.join(tempDir, "spec.local.md"), "existing copy", "utf8")
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const uploadDriveSyncFile = vi.fn(async () => ({ ...mockDriveItem("remote-copy"), id: "remote-copy" }))
      const harness = createHarness({
        accountService: {
          uploadDriveLocalItems,
          uploadDriveSyncFile,
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

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_both" })

      await expect(readFile(path.join(tempDir, "spec.local.md"), "utf8")).resolves.toBe("existing copy")
      await expect(readFile(path.join(tempDir, "spec.local-2.md"), "utf8")).resolves.toBe("local")
      await expect(readFile(localPath, "utf8")).resolves.toBe("remote")
      expect(uploadDriveSyncFile).toHaveBeenCalled()
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded", relativePath: "spec.local-2.md" }),
      )
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "resolved", resolution: "keep_both" })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps skipped conflicts open for later resolution", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const harness = createHarness()
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

      await service.resolveConflict({ conflictId: conflict.id, action: "skip" })

      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({
        status: "open",
        resolution: null,
        resolvedAt: null,
      })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ status: "conflict" })
      await expect(service.getSnapshot()).resolves.toMatchObject({
        conflicts: [expect.objectContaining({ id: conflict.id })],
        summary: { conflictCount: 1 },
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("keeps conflicts open when conflict resolution operations fail", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      const harness = createHarness({
        accountService: {
          downloadDriveFile: vi.fn(async () => {
            throw new Error("disk denied")
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

      await expect(service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" }))
        .rejects.toThrow("disk denied")

      await expect(readFile(localPath, "utf8")).resolves.toBe("local")
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({
        status: "open",
        resolution: null,
        resolvedAt: null,
      })
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({
        status: "error",
        lastError: "disk denied",
      })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "download", status: "error", relativePath: "spec.md" }),
      )
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

  it("keeps a conflicted path blocked after local write permission is denied", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "local", "utf8")
      let rawEvent: ((eventType: string, filename: string | Buffer | null) => void) | null = null
      const watch: DriveSyncWatchFactory = (_rootPath, _options, listener) => {
        rawEvent = listener
        return { close: vi.fn(), on: vi.fn() } as unknown as ReturnType<DriveSyncWatchFactory>
      }
      const uploadDriveLocalItems = vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 }))
      const permissionGuard: PermissionGuard = {
        registerPolicy: vi.fn(),
        check: vi.fn(async ({ action }) =>
          action === "fs.write.outside-userdata"
            ? { allowed: false as const, reason: "denied by test" }
            : { allowed: true as const },
        ),
      }
      const harness = createHarness({
        permissionGuard,
        watch,
        accountService: {
          uploadDriveLocalItems,
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
      const stats = await lstat(localPath)
      await seedFolderRootBaseline(harness, binding.id, "drive-root")
      await harness.baseline.upsert({
        id: `${binding.id}:spec.md`,
        schemaVersion: 1,
        bindingId: binding.id,
        relativePath: "spec.md",
        kind: "file",
        remoteItemId: "remote-spec",
        remoteVersionId: null,
        remoteEtag: null,
        localSize: stats.size,
        localMtimeMs: stats.mtimeMs,
        localHash: await hashDriveSyncFile(localPath),
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
        deletedAt: null,
      })
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-spec",
        relativePath: "spec.md",
        localPath,
        remotePathHint: "/Docs/spec.md",
        type: "both_modified",
      })

      await expect(service.resolveConflict({ conflictId: conflict.id, action: "keep_remote" })).rejects.toThrow("denied by test")
      await service.resumeBinding(binding.id)
      await writeFile(localPath, "user edit", "utf8")
      emitRawEvent(rawEvent, "change", "spec.md")

      await waitForExpect(async () => {
        await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "open" })
      }, 1000)
      expect(uploadDriveLocalItems).not.toHaveBeenCalled()
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

      expect(harness.deps.accountService.uploadDriveSyncFile).toHaveBeenCalled()
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "resolved", resolution: "keep_local" })
      await expect(harness.operations.list()).resolves.toContainEqual(
        expect.objectContaining({ bindingId: binding.id, kind: "upload", status: "succeeded" }),
      )
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("refreshes a conflict instead of applying a stale same-type local snapshot", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-conflict-refresh-"))
    try {
      const localPath = path.join(tempDir, "spec.md")
      await writeFile(localPath, "before", "utf8")
      const previousHash = await hashDriveSyncFile(localPath)
      const harness = createHarness()
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
        driveItemId: "remote-spec",
        relativePath: "spec.md",
        localPath,
        remotePathHint: "/Docs/spec.md",
        type: "both_modified",
        localSnapshot: { kind: "file", hash: previousHash },
        remoteSnapshot: { kind: "file" },
      })
      await writeFile(localPath, "changed again", "utf8")

      await expect(service.resolveConflict({ conflictId: conflict.id, action: "keep_local" }))
        .rejects.toThrow("冲突内容已变化，请重新确认处理方式。")

      expect(harness.deps.accountService.uploadDriveSyncFile).not.toHaveBeenCalled()
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({
        status: "open",
        localSnapshot: expect.objectContaining({ hash: await hashDriveSyncFile(localPath) }),
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("recreates a missing remote folder from the complete included local subtree", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-service-"))
    try {
      await mkdir(path.join(tempDir, "nested"), { recursive: true })
      await mkdir(path.join(tempDir, "dist"), { recursive: true })
      await writeFile(path.join(tempDir, "keep.md"), "keep", "utf8")
      await writeFile(path.join(tempDir, "nested", "child.md"), "child", "utf8")
      await writeFile(path.join(tempDir, "dist", "excluded.js"), "excluded", "utf8")
      const notFound = Object.assign(new Error("NOT_FOUND"), { status: 404 })
      const createDriveFolder = vi.fn(async ({ name }: { name: string }) => ({
        id: name === path.basename(tempDir) ? "remote-root-new" : `remote-${name}`,
        name,
        type: "folder",
      }))
      const uploadDriveSyncFile = vi.fn(async (input: Parameters<DriveSyncAccountService["uploadDriveSyncFile"]>[0]) => ({
        ...mockDriveItem(`remote-${input.name}`),
        parentId: input.parentId,
        name: input.name,
      }))
      const harness = createHarness({
        accountService: {
          getDriveItem: vi.fn(async () => { throw notFound }),
          createDriveFolder,
          uploadDriveSyncFile,
        },
      })
      const service = createDriveSyncService(harness.deps)
      const binding = await service.createBinding({
        driveItemId: "remote-root-old",
        remoteParentId: "remote-parent",
        driveItemName: path.basename(tempDir),
        kind: "folder",
        localPath: tempDir,
      })
      await seedFolderRootBaseline(harness, binding.id, "remote-root-old")
      const conflict = await service.recordConflict({
        bindingId: binding.id,
        driveItemId: "remote-root-old",
        relativePath: "",
        localPath: tempDir,
        type: "delete_vs_modify",
        localSnapshot: { exists: true },
        remoteSnapshot: null,
      })

      await service.resolveConflict({ conflictId: conflict.id, action: "keep_local" })

      expect(createDriveFolder).toHaveBeenCalledWith({ parentId: "remote-parent", name: path.basename(tempDir) })
      expect(createDriveFolder).toHaveBeenCalledWith({ parentId: "remote-root-new", name: "nested" })
      expect(uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-root-new", name: "keep.md" }))
      expect(uploadDriveSyncFile).toHaveBeenCalledWith(expect.objectContaining({ parentId: "remote-nested", name: "child.md" }))
      expect(uploadDriveSyncFile).not.toHaveBeenCalledWith(expect.objectContaining({ name: "excluded.js" }))
      await expect(harness.bindings.get(binding.id)).resolves.toMatchObject({ driveItemId: "remote-root-new", status: "active" })
      await expect(harness.conflicts.get(conflict.id)).resolves.toMatchObject({ status: "resolved", resolution: "keep_local" })
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

function createDeferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
  let resolveDeferred: (value: T) => void = () => {}
  let rejectDeferred: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

function emitRawEvent(
  listener: ((eventType: string, filename: string | Buffer | null) => void) | null,
  eventType: string,
  filename: string | Buffer | null,
): void {
  if (!listener) throw new Error("expected raw watcher event listener")
  listener(eventType, filename)
}

function createHarness(overrides: {
  readonly accountService?: Record<string, unknown>
  readonly auditSink?: AuditSink
  readonly permissionGuard?: PermissionGuard
  readonly stagingRootPath?: string
  readonly watch?: DriveSyncWatchFactory
} = {}) {
  const bindings = createMemoryNamespace<DriveSyncBindingEntryV1>()
  const baseline = createMemoryNamespace<DriveSyncBaselineEntryV1>()
  const operations = createMemoryNamespace<DriveSyncOperationEntryV1>()
  const conflicts = createMemoryNamespace<DriveSyncConflictEntryV1>()
  const state = createMemoryNamespace<DriveSyncStateEntryV1>()
  const remoteContents = new Map<string, Buffer>()
  const accountService = {
    getDriveItem: vi.fn(async (itemId: string) => mockDriveItem(itemId)),
    downloadDriveFile: vi.fn(async ({ itemId, outputPath }: { itemId: string; outputPath: string }) => {
      await writeFile(outputPath, remoteContents.get(itemId) ?? Buffer.from("remote"))
      return { ok: true as const, path: outputPath }
    }),
    downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const, path: "" })),
    uploadDriveLocalItems: vi.fn(async () => ({ completed: 1, failed: 0, skipped: 0 })),
    uploadDriveSyncFile: vi.fn(async (input: { parentId: string | null; path: string; name: string; expectedItemId?: string | null }) => {
      const itemId = input.expectedItemId ?? "remote-upload"
      remoteContents.set(itemId, await readFile(input.path))
      return {
        ...mockDriveItem(itemId),
        parentId: input.parentId,
        name: input.name,
      }
    }),
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
      stagingRootPath: overrides.stagingRootPath,
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
  const type: "file" | "folder" = lower.includes("folder") || lower.includes("docs") || lower.includes("root") ? "folder" : "file"
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
