import { describe, expect, it, vi } from "vitest"
import { driveSyncIpcModule } from "../ipc"

describe("driveSyncIpcModule", () => {
  it("registers drive sync channels", () => {
    expect(driveSyncIpcModule.methods.getSnapshot.channel).toBe("synapse:drive-sync:snapshot:get")
    expect(driveSyncIpcModule.methods.createBinding.channel).toBe("synapse:drive-sync:bindings:create")
    expect(driveSyncIpcModule.methods.removeBinding.channel).toBe("synapse:drive-sync:bindings:remove")
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
})
