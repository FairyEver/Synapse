import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { AgentPersonaRemoteCacheEntryV1 } from "../../../../electron/runtime/data-repo/schemas/agent-persona-remote-cache"
import {
  createInMemoryHarness,
  IpcValidationError,
  type IpcHandlerContext,
} from "../../../../electron/runtime/ipc"
import type { AgentPersona } from "../../shared/schema"
import { AgentPersonaCache } from "../cache"
import { agentPersonasIpcModule } from "../ipc"
import { createAgentPersonaService } from "../service"

const builtinId = "builtin-zh-en-translator"

describe("Agent personas public IPC contract", () => {
  it("manages user personas through cloud-backed public channels", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:app:agent_personas:operation:list", undefined))
      .resolves.toMatchObject({
        status: "online",
        items: [{ id: builtinId, source: "builtin", readonly: true }],
      })

    const created = await harness.invoke("synapse:app:agent_personas:operation:create", {
      name: "  产品顾问  ",
      description: "  整理产品判断。  ",
      systemPrompt: "  你是产品顾问。  ",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    }) as { id: string }

    expect(created).toMatchObject({
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "user",
      readonly: false,
    })

    await expect(harness.invoke("synapse:app:agent_personas:operation:list", undefined))
      .resolves.toMatchObject({
        status: "online",
        items: [
          { id: builtinId, source: "builtin", readonly: true },
          { id: created.id, name: "产品顾问", source: "user", readonly: false },
        ],
      })

    await expect(harness.invoke("synapse:app:agent_personas:operation:update", {
      id: created.id,
      name: "产品教练",
      description: "整理产品策略。",
      systemPrompt: "你是产品教练。",
      providerModel: null,
    })).resolves.toMatchObject({
      id: created.id,
      name: "产品教练",
      providerModel: null,
    })

    await expect(harness.invoke("synapse:app:agent_personas:operation:delete", { id: created.id }))
      .resolves.toBeUndefined()
    await expect(harness.invoke("synapse:app:agent_personas:operation:list", undefined))
      .resolves.toMatchObject({
        status: "online",
        items: [{ id: builtinId, source: "builtin", readonly: true }],
      })
  })

  it("rejects invalid public payloads at the IPC boundary", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:app:agent_personas:operation:create", {
      name: "产品顾问",
      description: "整理产品判断。",
    })).rejects.toBeInstanceOf(IpcValidationError)

    await expect(harness.invoke("synapse:app:agent_personas:operation:create", {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "invalid" },
    })).rejects.toBeInstanceOf(IpcValidationError)
  })

  it("relies on remote authorization for built-in mutations", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:app:agent_personas:operation:update", {
      id: builtinId,
      name: "中英翻译",
      description: "修改描述。",
      systemPrompt: "修改提示词。",
      providerModel: null,
    })).rejects.toThrow("内置智能体不可编辑")

    await expect(harness.invoke("synapse:app:agent_personas:operation:delete", {
      id: builtinId,
    })).rejects.toThrow("内置智能体不可删除")
  })

  it("allows built-in model updates through the dedicated public channel", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:app:agent_personas:builtin_model:update", {
      id: builtinId,
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })).resolves.toMatchObject({
      id: builtinId,
      source: "builtin",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })

    await expect(harness.invoke("synapse:app:agent_personas:operation:list", undefined))
      .resolves.toMatchObject({
        items: [{
          id: builtinId,
          source: "builtin",
          providerModel: { providerId: "claude", modelTier: "sonnet" },
        }],
      })
  })

  it("broadcasts changed events after public mutations", async () => {
    const harness = createBlackBoxHarness()

    await harness.invoke("synapse:app:agent_personas:operation:create", {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
    })

    expect(harness.broadcast).toHaveBeenCalledWith(
      "synapse:app:agent_personas:operation:changed",
      {
        result: expect.objectContaining({
          status: "online",
          items: expect.arrayContaining([
            expect.objectContaining({ id: builtinId, source: "builtin" }),
            expect.objectContaining({ name: "产品顾问", source: "user" }),
          ]),
        }),
        items: expect.arrayContaining([
          expect.objectContaining({ id: builtinId, source: "builtin" }),
          expect.objectContaining({ name: "产品顾问", source: "user" }),
        ]),
      },
    )
  })
})

function createBlackBoxHarness() {
  const cache = createMemorySingletonNamespace<AgentPersonaRemoteCacheEntryV1>()
  const personas: AgentPersona[] = [remoteBuiltin()]
  const remote = {
    list: vi.fn(async () => personas),
    create: vi.fn(async (input: { name: string; description: string; systemPrompt: string; providerModel?: AgentPersona["providerModel"] }) => {
      const item = remoteUser({
        id: `persona-${personas.length}`,
        name: input.name.trim(),
        description: input.description.trim(),
        systemPrompt: input.systemPrompt.trim(),
        providerModel: input.providerModel ?? null,
      })
      personas.push(item)
      return item
    }),
    update: vi.fn(async (input: { id: string; name: string; description: string; systemPrompt: string; providerModel?: AgentPersona["providerModel"] }) => {
      const index = personas.findIndex((item) => item.id === input.id && item.source === "user")
      if (index < 0) throw new Error("内置智能体不可编辑")
      const item = remoteUser({
        id: input.id,
        name: input.name.trim(),
        description: input.description.trim(),
        systemPrompt: input.systemPrompt.trim(),
        providerModel: input.providerModel ?? null,
      })
      personas[index] = item
      return item
    }),
    updateBuiltinModel: vi.fn(async (input: { id: string; providerModel: AgentPersona["providerModel"] }) => {
      const index = personas.findIndex((item) => item.id === input.id && item.source === "builtin")
      if (index < 0) throw new Error("内置智能体不存在")
      const item = { ...personas[index]!, providerModel: input.providerModel } as AgentPersona
      personas[index] = item
      return item
    }),
    delete: vi.fn(async (input: { id: string }) => {
      const index = personas.findIndex((item) => item.id === input.id && item.source === "user")
      if (index < 0) throw new Error("内置智能体不可删除")
      personas.splice(index, 1)
    }),
  }
  const service = createAgentPersonaService({
    remote,
    cache: new AgentPersonaCache(cache),
    account: { getState: () => authenticatedOnline("user-1") },
    now: () => new Date("2026-07-01T00:00:00.000Z"),
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  })
  const broadcast = vi.fn()
  const ipc = createInMemoryHarness()
  const ctx: IpcHandlerContext = {
    moduleId: "agentPersonas",
    resolve<T>(serviceId: string): T {
      if (serviceId === "core.agent-personas") return service as T
      if (serviceId === "core.window-manager") return { broadcast } as T
      throw new Error(serviceId)
    },
  }

  ipc.registry.register(agentPersonasIpcModule, ctx)

  return {
    broadcast,
    invoke: ipc.invoke,
  }
}

function authenticatedOnline(userId: string) {
  return {
    status: "authenticated" as const,
    connectivity: "online" as const,
    profile: {
      user: { id: userId, email: `${userId}@example.test`, displayName: null, status: "active" as const },
      teams: [],
      syncedAt: "2026-07-01T00:00:00.000Z",
    },
  }
}

function remoteBuiltin(overrides: Partial<AgentPersona> = {}): AgentPersona {
  return {
    id: builtinId,
    schemaVersion: 1,
    name: "中英翻译",
    description: "在中文和英文之间互译。",
    systemPrompt: "你是中英翻译智能体。",
    providerModel: null,
    toolPolicy: { mode: "disabled" },
    source: "builtin",
    readonly: true,
    version: 1,
    ...overrides,
  }
}

function remoteUser(overrides: Partial<AgentPersona> = {}): AgentPersona {
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
    ...overrides,
  }
}

function createMemorySingletonNamespace<T>(): DataNamespace<T> & { singleton: T | null } {
  const events = new EventEmitter()
  const namespace = {
    name: "memory",
    schemaVersion: 1,
    backend: "json",
    singleton: null as T | null,
    async getSingleton() { return namespace.singleton },
    async setSingleton(value: T) { namespace.singleton = value },
    async clearSingleton() { namespace.singleton = null },
    async list() { return [] },
    async count() { return 0 },
    async get() { return null },
    async upsert() {},
    async remove() {},
    onChange(listener: (change: never) => void) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  } satisfies DataNamespace<T> & { singleton: T | null }
  return namespace
}
