import { describe, expect, it, vi } from "vitest"
import { secretsIpcModule } from "../ipc"

describe("secretsIpcModule", () => {
  it("registers secrets channels", () => {
    expect(secretsIpcModule.id).toBe("secrets")
    expect(secretsIpcModule.methods.list.channel).toBe("synapse:secrets:list")
    expect(secretsIpcModule.methods.get.channel).toBe("synapse:secrets:get")
    expect(secretsIpcModule.methods.create.channel).toBe("synapse:secrets:create")
    expect(secretsIpcModule.methods.update.channel).toBe("synapse:secrets:update")
    expect(secretsIpcModule.methods.upsert.channel).toBe("synapse:secrets:upsert")
    expect(secretsIpcModule.methods.delete.channel).toBe("synapse:secrets:delete")
    expect(secretsIpcModule.events.changed.channel).toBe("synapse:secrets:changed")
  })

  it("dispatches methods through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => ({ secrets: [], total: 0 })),
      get: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
      create: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
      update: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
      upsert: vi.fn(async () => ({ secret: { id: "id-1", name: "TOKEN", hasValue: true }, created: true })),
      delete: vi.fn(async () => ({ id: "id-1", name: "TOKEN", hasValue: true })),
    }
    const broadcast = vi.fn()
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.secrets") return service
        if (id === "core.window-manager") return { broadcast }
        throw new Error(id)
      }),
    }

    await expect(secretsIpcModule.methods.list.handler(ctx as never, undefined)).resolves.toEqual({ secrets: [], total: 0 })
    await secretsIpcModule.methods.get.handler(ctx as never, { name: "TOKEN" })
    await secretsIpcModule.methods.create.handler(ctx as never, { name: "TOKEN", value: "secret" })
    await secretsIpcModule.methods.update.handler(ctx as never, { name: "TOKEN", description: "api" })
    await secretsIpcModule.methods.upsert.handler(ctx as never, { name: "TOKEN", value: "secret" })
    await secretsIpcModule.methods.delete.handler(ctx as never, { name: "TOKEN" })

    expect(service.list).toHaveBeenCalled()
    expect(service.get).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(service.create).toHaveBeenCalledWith({ name: "TOKEN", value: "secret" })
    expect(service.update).toHaveBeenCalledWith({ name: "TOKEN", description: "api" })
    expect(service.upsert).toHaveBeenCalledWith({ name: "TOKEN", value: "secret" })
    expect(service.delete).toHaveBeenCalledWith({ name: "TOKEN" })
    expect(service.events.on).toHaveBeenCalledWith("changed", expect.any(Function))
  })
})
