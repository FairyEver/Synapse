import { describe, expect, it, vi } from "vitest"
import { quickInputIpcModule } from "../ipc"

describe("quickInputIpcModule", () => {
  it("registers quick input channels", () => {
    expect(quickInputIpcModule.methods.list.channel).toBe("synapse:quick-input:list")
    expect(quickInputIpcModule.methods.create.channel).toBe("synapse:quick-input:create")
    expect(quickInputIpcModule.methods.update.channel).toBe("synapse:quick-input:update")
    expect(quickInputIpcModule.methods.delete.channel).toBe("synapse:quick-input:delete")
    expect(quickInputIpcModule.methods.pinToTop.channel).toBe("synapse:quick-input:pin-to-top")
    expect(quickInputIpcModule.events.changed.channel).toBe("synapse:quick-input:changed")
  })

  it("dispatches list through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.quick-input") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(quickInputIpcModule.methods.list.handler(ctx as never, undefined)).resolves.toEqual([])
    expect(service.list).toHaveBeenCalled()
  })
})
