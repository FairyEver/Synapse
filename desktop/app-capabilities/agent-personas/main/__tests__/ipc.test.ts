import { describe, expect, it, vi } from "vitest"
import { agentPersonasIpcModule } from "../ipc"

describe("agentPersonasIpcModule", () => {
  it("registers agent persona channels", () => {
    expect(agentPersonasIpcModule.methods.list.channel).toBe("synapse:agent-personas:list")
    expect(agentPersonasIpcModule.methods.create.channel).toBe("synapse:agent-personas:create")
    expect(agentPersonasIpcModule.methods.update.channel).toBe("synapse:agent-personas:update")
    expect(agentPersonasIpcModule.methods.delete.channel).toBe("synapse:agent-personas:delete")
    expect(agentPersonasIpcModule.events.changed.channel).toBe("synapse:agent-personas:changed")
  })

  it("dispatches list through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.agent-personas") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(agentPersonasIpcModule.methods.list.handler(ctx as never, undefined))
      .resolves.toEqual([])
    expect(service.list).toHaveBeenCalled()
  })

  it("validates create request shape", () => {
    expect(agentPersonasIpcModule.methods.create.request.safeParse({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    }).success).toBe(true)

    expect(agentPersonasIpcModule.methods.create.request.safeParse({
      name: "产品顾问",
      description: "整理产品判断。",
      providerModel: { providerId: "claude", modelTier: "invalid" },
    }).success).toBe(false)
  })

  it("dispatches create through the core service", async () => {
    const created = {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      source: "user",
      readonly: false,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    }
    const service = {
      events: { on: vi.fn() },
      create: vi.fn(async () => created),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.agent-personas") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }
    const input = {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
    }

    await expect(agentPersonasIpcModule.methods.create.handler(ctx as never, input))
      .resolves.toEqual(created)
    expect(service.create).toHaveBeenCalledWith(input)
  })

  it("broadcasts changed events after wiring the service once", async () => {
    const listeners: Array<(payload: unknown) => void> = []
    const broadcast = vi.fn()
    const service = {
      events: {
        on: vi.fn((_eventName: "changed", listener: (payload: unknown) => void) => {
          listeners.push(listener)
        }),
      },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.agent-personas") return service
        if (id === "core.window-manager") return { broadcast }
        throw new Error(id)
      }),
    }

    await agentPersonasIpcModule.methods.list.handler(ctx as never, undefined)
    await agentPersonasIpcModule.methods.list.handler(ctx as never, undefined)

    expect(service.events.on).toHaveBeenCalledTimes(1)
    listeners[0]?.({ items: [] })
    expect(broadcast).toHaveBeenCalledWith("synapse:agent-personas:changed", { items: [] })
  })
})
