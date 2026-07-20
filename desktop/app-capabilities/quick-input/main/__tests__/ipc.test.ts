import { describe, expect, it, vi } from "vitest"
import { quickInputIpcModule } from "../ipc"

describe("quickInputIpcModule", () => {
  it("registers quick input channels", () => {
    expect(quickInputIpcModule.methods.list.operationId).toBe("app.quick_input.item.list")
    expect(quickInputIpcModule.methods.create.operationId).toBe("app.quick_input.item.create")
    expect(quickInputIpcModule.methods.update.operationId).toBe("app.quick_input.item.update")
    expect(quickInputIpcModule.methods.delete.operationId).toBe("app.quick_input.item.delete")
    expect(quickInputIpcModule.events.changed.operationId).toBe("app.quick_input.item.changed")
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
