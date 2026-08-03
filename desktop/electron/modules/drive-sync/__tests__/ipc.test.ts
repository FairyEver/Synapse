import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
  },
}))

import { dialog } from "electron"
import { createInMemoryHarness } from "../../../runtime/ipc"
import { driveSyncIpcModule } from "../ipc"

describe("driveSyncIpcModule", () => {
  it("registers drive sync channels", () => {
    expect(driveSyncIpcModule.methods.getSnapshot.operationId).toBe("app.drive_sync.snapshot.get")
    expect(driveSyncIpcModule.methods).not.toHaveProperty("createBinding")
    expect(driveSyncIpcModule.methods.previewBinding.operationId).toBe("app.drive_sync.bindings.preview")
    expect(driveSyncIpcModule.methods.createSafeBinding.operationId).toBe("app.drive_sync.bindings.safe_create")
    expect(driveSyncIpcModule.methods.removeBinding.operationId).toBe("app.drive_sync.bindings.remove")
    expect(driveSyncIpcModule.methods.pauseBinding.operationId).toBe("app.drive_sync.bindings.pause")
    expect(driveSyncIpcModule.methods.resumeBinding.operationId).toBe("app.drive_sync.bindings.resume")
    expect(driveSyncIpcModule.methods.updateExcludeRules.operationId).toBe("app.drive_sync.bindings.exclude_rules.update")
    expect(driveSyncIpcModule.methods.rescanBinding.operationId).toBe("app.drive_sync.bindings.rescan")
    expect(driveSyncIpcModule.methods.pollRemoteChanges.operationId).toBe("app.drive_sync.remote.poll")
    expect(driveSyncIpcModule.methods.resolveConflict.operationId).toBe("app.drive_sync.conflicts.resolve")
    expect(driveSyncIpcModule.methods.chooseLocalPath.operationId).toBe("app.drive_sync.local_path.choose")
    expect(driveSyncIpcModule.events.changed.operationId).toBe("app.drive_sync.operation.changed")
  })

  it("dispatches snapshot through the core service", async () => {
    const snapshot = {
      bindings: [{
        id: "binding-1",
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        drivePathHint: null,
        kind: "file",
        localPath: "/tmp/spec.md",
        status: "error",
        remoteCursor: null,
        excludeRules: {
          forced: [],
          defaults: [],
          importedGitignore: [],
          user: [],
        },
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastSyncedAt: null,
        lastError: "本地文件不存在",
      }],
      conflicts: [],
      operations: [],
      health: {
        status: "error",
        readOnly: false,
        lastError: "network unavailable",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 0,
        retryWaitingOperationCount: 0,
        conflictCount: 0,
        errorCount: 1,
      },
    }
    const service = {
      events: { on: vi.fn() },
      getSnapshot: vi.fn(async () => snapshot),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.drive-sync") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(driveSyncIpcModule.methods.getSnapshot.handler(ctx as never, undefined)).resolves.toEqual(snapshot)
    expect(driveSyncIpcModule.methods.getSnapshot.response?.parse(snapshot)).toEqual(snapshot)
    expect(service.getSnapshot).toHaveBeenCalled()
  })

  it("preserves status, retry, and progress fields through the real IPC registry", async () => {
    const snapshot = {
      bindings: [],
      conflicts: [],
      operations: [{
        id: "operation-1",
        bindingId: "binding-1",
        kind: "resync",
        relativePath: "",
        status: "retry_wait",
        message: "等待网络恢复",
        attemptCount: 3,
        nextRetryAt: "2026-06-28T00:01:00.000Z",
        completedBytes: 4,
        totalBytes: 10,
        updatedAt: "2026-06-28T00:00:00.000Z",
      }],
      health: {
        status: "retrying",
        readOnly: true,
        lastError: "offline",
        updatedAt: "2026-06-28T00:00:00.000Z",
      },
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 0,
        retryWaitingOperationCount: 1,
        conflictCount: 0,
        errorCount: 0,
      },
    }
    const service = { events: { on: vi.fn() }, getSnapshot: vi.fn(async () => snapshot) }
    const harness = createInMemoryHarness()
    harness.registry.register(driveSyncIpcModule, {
      moduleId: "driveSync",
      resolve: ((id: string) => {
        if (id === "core.drive-sync") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }) as never,
    })

    await expect(harness.invoke("synapse:app:drive_sync:snapshot:get", undefined)).resolves.toEqual(snapshot)
  })

  it("dispatches binding management methods through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      previewBinding: vi.fn(async () => ({
        status: "ready",
        direction: "remote_to_local",
        reason: null,
        localPath: "/tmp/spec.md",
        localKind: "missing",
        localEmpty: null,
        forcedExcludeRules: [".git/**", ".git"],
        defaultExcludeRules: [],
        importedGitignoreRules: [],
        detectedGitignoreRules: [],
      })),
      createSafeBinding: vi.fn(async () => ({
        id: "binding-1",
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath: "/tmp/spec.md",
        status: "active",
        remoteCursor: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastSyncedAt: null,
      })),
      pauseBinding: vi.fn(async () => ({
        id: "binding-1",
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath: "/tmp/spec.md",
        status: "paused",
        remoteCursor: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastSyncedAt: null,
      })),
      resumeBinding: vi.fn(async () => ({
        id: "binding-1",
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath: "/tmp/spec.md",
        status: "active",
        remoteCursor: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastSyncedAt: null,
      })),
      updateExcludeRules: vi.fn(async () => ({
        id: "binding-1",
        driveItemId: "drive-item-1",
        driveItemName: "spec.md",
        kind: "file",
        localPath: "/tmp/spec.md",
        status: "active",
        remoteCursor: null,
        createdAt: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        lastSyncedAt: null,
      })),
      rescanBinding: vi.fn(async () => undefined),
      pollRemoteChanges: vi.fn(async () => undefined),
      resolveConflict: vi.fn(async () => undefined),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.drive-sync") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await driveSyncIpcModule.methods.previewBinding.handler(ctx as never, {
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "folder",
      localPath: "/tmp/spec.md",
      remoteExists: true,
      excludeRules: ["build/**"],
    })
    await driveSyncIpcModule.methods.createSafeBinding.handler(ctx as never, {
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: "/tmp/spec.md",
      direction: "bind_existing",
    })
    await driveSyncIpcModule.methods.pauseBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.resumeBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.updateExcludeRules.handler(ctx as never, {
      id: "binding-1",
      defaults: ["node_modules/"],
      importedGitignore: ["dist/"],
      user: ["private/"],
    })
    await driveSyncIpcModule.methods.rescanBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.pollRemoteChanges.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.resolveConflict.handler(ctx as never, { conflictId: "conflict-1", action: "keep_local" })

    expect(service.previewBinding).toHaveBeenCalledWith(expect.objectContaining({ excludeRules: ["build/**"] }))
    expect(service.createSafeBinding).toHaveBeenCalled()
    expect(service.pauseBinding).toHaveBeenCalledWith("binding-1")
    expect(service.resumeBinding).toHaveBeenCalledWith("binding-1")
    expect(service.updateExcludeRules).toHaveBeenCalledWith({
      id: "binding-1",
      defaults: ["node_modules/"],
      importedGitignore: ["dist/"],
      user: ["private/"],
    })
    expect(service.rescanBinding).toHaveBeenCalledWith("binding-1")
    expect(service.pollRemoteChanges).toHaveBeenCalledWith("binding-1")
    expect(service.resolveConflict).toHaveBeenCalledWith({ conflictId: "conflict-1", action: "keep_local" })
  })

  it("chooses local paths with mode-specific dialogs", async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ["/Users/me/Desktop/spec.md"] })
    await expect(driveSyncIpcModule.methods.chooseLocalPath.handler({} as never, {
      kind: "file",
      mode: "bind_existing",
      defaultName: "spec.md",
    })).resolves.toBe("/Users/me/Desktop/spec.md")
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ["openFile"] })

    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: "/Users/me/Desktop/spec.md" })
    await expect(driveSyncIpcModule.methods.chooseLocalPath.handler({} as never, {
      kind: "file",
      mode: "remote_to_local",
      defaultName: "spec.md",
    })).resolves.toBe("/Users/me/Desktop/spec.md")
    expect(dialog.showSaveDialog).toHaveBeenCalledWith({ defaultPath: "spec.md" })

    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ["/Users/me/Desktop"] })
    await expect(driveSyncIpcModule.methods.chooseLocalPath.handler({} as never, {
      kind: "folder",
      mode: "remote_to_local",
      defaultName: "Docs",
    })).resolves.toBe("/Users/me/Desktop/Docs")

    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ["/Users/me/Desktop/local.md"] })
    await expect(driveSyncIpcModule.methods.chooseLocalPath.handler({} as never, {
      kind: "file",
      mode: "local_to_remote",
    })).resolves.toBe("/Users/me/Desktop/local.md")

    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: ["/Users/me/Desktop/LocalDocs"] })
    await expect(driveSyncIpcModule.methods.chooseLocalPath.handler({} as never, {
      kind: "folder",
      mode: "local_to_remote",
      defaultName: "Docs",
    })).resolves.toBe("/Users/me/Desktop/LocalDocs")
  })
})
