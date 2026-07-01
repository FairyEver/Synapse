import { describe, expect, it, vi } from "vitest"
import type { AgentPersona, AgentPersonaListResult } from "../../shared/schema"
import { agentPersonasIpcModule } from "../ipc"

describe("agentPersonasIpcModule", () => {
  it("registers agent persona channels", () => {
    expect(agentPersonasIpcModule.methods.list.channel).toBe("synapse:agent-personas:list")
    expect(agentPersonasIpcModule.methods.create.channel).toBe("synapse:agent-personas:create")
    expect(agentPersonasIpcModule.methods.update.channel).toBe("synapse:agent-personas:update")
    expect(agentPersonasIpcModule.methods.updateBuiltinModel.channel)
      .toBe("synapse:agent-personas:builtin-model:update")
    expect(agentPersonasIpcModule.methods.delete.channel).toBe("synapse:agent-personas:delete")
    expect(agentPersonasIpcModule.events.changed.channel).toBe("synapse:agent-personas:changed")
  })

  it("dispatches list through the core service", async () => {
    const result: AgentPersonaListResult = { status: "unauthenticated", items: [] }
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => result),
    }
    const ctx = createCtx(service)

    await expect(agentPersonasIpcModule.methods.list.handler(ctx as never, undefined))
      .resolves.toEqual(result)
    expect(agentPersonasIpcModule.methods.list.response.safeParse(result).success).toBe(true)
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

  it("validates built-in model update request shape", () => {
    expect(agentPersonasIpcModule.methods.updateBuiltinModel.request.safeParse({
      id: "builtin-zh-en-translator",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    }).success).toBe(true)

    expect(agentPersonasIpcModule.methods.updateBuiltinModel.request.safeParse({
      id: "builtin-zh-en-translator",
      providerModel: null,
    }).success).toBe(true)

    expect(agentPersonasIpcModule.methods.updateBuiltinModel.request.safeParse({
      id: "builtin-zh-en-translator",
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
    const ctx = createCtx(service)
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

  it("dispatches built-in model update through the core service", async () => {
    const updated = {
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译，保留原意、语气和格式。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "builtin",
      readonly: true,
    }
    const service = {
      events: { on: vi.fn() },
      updateBuiltinModel: vi.fn(async () => updated),
    }
    const ctx = createCtx(service)
    const input = {
      id: "builtin-zh-en-translator",
      providerModel: { providerId: "claude", modelTier: "sonnet" as const },
    }

    await expect(agentPersonasIpcModule.methods.updateBuiltinModel.handler(ctx as never, input))
      .resolves.toEqual(updated)
    expect(service.updateBuiltinModel).toHaveBeenCalledWith(input)
  })

  it("broadcasts changed events after wiring the service once", async () => {
    const listeners: Array<(payload: unknown) => void> = []
    const broadcast = vi.fn()
    const service = createEventService(listeners)
    const ctx = createCtx(service, broadcast)

    await agentPersonasIpcModule.methods.list.handler(ctx as never, undefined)
    await agentPersonasIpcModule.methods.list.handler(ctx as never, undefined)

    expect(service.events.on).toHaveBeenCalledTimes(1)
    const result: AgentPersonaListResult = {
      status: "online",
      items: [persona()],
      syncedAt: "2026-07-01T00:00:00.000Z",
    }
    listeners[0]?.(result)
    expect(broadcast).toHaveBeenCalledWith("synapse:agent-personas:changed", {
      result,
      items: [persona()],
    })
  })
})

function createCtx(service: unknown, broadcast = vi.fn()) {
  return {
    resolve: vi.fn((id: string) => {
      if (id === "core.agent-personas") return service
      if (id === "core.window-manager") return { broadcast }
      throw new Error(id)
    }),
  }
}

function createEventService(listeners: Array<(payload: AgentPersonaListResult) => void>) {
  return {
    events: {
      on: vi.fn((_eventName: "changed", listener: (payload: AgentPersonaListResult) => void) => {
        listeners.push(listener)
      }),
    },
    list: vi.fn(async () => ({ status: "unauthenticated" as const, items: [] })),
  }
}

function persona(): AgentPersona {
  return {
    id: "persona-1",
    schemaVersion: 1,
    name: "产品顾问",
    description: "整理产品判断。",
    systemPrompt: "你是产品顾问。",
    providerModel: null,
    toolPolicy: null,
    source: "user",
    readonly: false,
    version: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  }
}
