import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  },
}))

import { driveSyncIpcModule } from "../ipc"

describe("driveSyncIpcModule", () => {
  it("registers drive sync channels", () => {
    expect(driveSyncIpcModule.methods.getSnapshot.channel).toBe("synapse:drive-sync:snapshot:get")
    expect(driveSyncIpcModule.methods.createBinding.channel).toBe("synapse:drive-sync:bindings:create")
    expect(driveSyncIpcModule.methods.previewBinding.channel).toBe("synapse:drive-sync:bindings:preview")
    expect(driveSyncIpcModule.methods.createSafeBinding.channel).toBe("synapse:drive-sync:bindings:safe-create")
    expect(driveSyncIpcModule.methods.removeBinding.channel).toBe("synapse:drive-sync:bindings:remove")
    expect(driveSyncIpcModule.methods.pauseBinding.channel).toBe("synapse:drive-sync:bindings:pause")
    expect(driveSyncIpcModule.methods.resumeBinding.channel).toBe("synapse:drive-sync:bindings:resume")
    expect(driveSyncIpcModule.methods.updateExcludeRules.channel).toBe("synapse:drive-sync:bindings:exclude-rules:update")
    expect(driveSyncIpcModule.methods.rescanBinding.channel).toBe("synapse:drive-sync:bindings:rescan")
    expect(driveSyncIpcModule.methods.pollRemoteChanges.channel).toBe("synapse:drive-sync:remote:poll")
    expect(driveSyncIpcModule.methods.resolveConflict.channel).toBe("synapse:drive-sync:conflicts:resolve")
    expect(driveSyncIpcModule.methods.chooseLocalPath.channel).toBe("synapse:drive-sync:local-path:choose")
    expect(driveSyncIpcModule.events.changed.channel).toBe("synapse:drive-sync:changed")
  })

  it("dispatches snapshot through the core service", async () => {
    const snapshot = {
      bindings: [],
      conflicts: [],
      operations: [],
      summary: {
        activeBindingCount: 0,
        runningOperationCount: 0,
        conflictCount: 0,
        errorCount: 0,
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
    expect(service.getSnapshot).toHaveBeenCalled()
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
      kind: "file",
      localPath: "/tmp/spec.md",
      remoteExists: true,
    })
    await driveSyncIpcModule.methods.createSafeBinding.handler(ctx as never, {
      driveItemId: "drive-item-1",
      driveItemName: "spec.md",
      kind: "file",
      localPath: "/tmp/spec.md",
      direction: "remote_to_local",
    })
    await driveSyncIpcModule.methods.pauseBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.resumeBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.updateExcludeRules.handler(ctx as never, { id: "binding-1", user: ["dist/**"] })
    await driveSyncIpcModule.methods.rescanBinding.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.pollRemoteChanges.handler(ctx as never, { id: "binding-1" })
    await driveSyncIpcModule.methods.resolveConflict.handler(ctx as never, { conflictId: "conflict-1", action: "keep_local" })

    expect(service.previewBinding).toHaveBeenCalled()
    expect(service.createSafeBinding).toHaveBeenCalled()
    expect(service.pauseBinding).toHaveBeenCalledWith("binding-1")
    expect(service.resumeBinding).toHaveBeenCalledWith("binding-1")
    expect(service.updateExcludeRules).toHaveBeenCalledWith({ id: "binding-1", user: ["dist/**"] })
    expect(service.rescanBinding).toHaveBeenCalledWith("binding-1")
    expect(service.pollRemoteChanges).toHaveBeenCalledWith("binding-1")
    expect(service.resolveConflict).toHaveBeenCalledWith({ conflictId: "conflict-1", action: "keep_local" })
  })
})
