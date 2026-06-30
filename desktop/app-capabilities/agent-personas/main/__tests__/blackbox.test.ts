import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"

import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type {
  AgentPersonaItemEntryV1,
  AgentPersonaSettingsEntryV1,
} from "../../../../electron/runtime/data-repo/schemas/agent-personas"
import {
  createInMemoryHarness,
  IpcValidationError,
  type IpcHandlerContext,
} from "../../../../electron/runtime/ipc"
import { BUILTIN_ZH_EN_TRANSLATOR_ID } from "../../shared/defaults"
import { agentPersonasIpcModule } from "../ipc"
import { createAgentPersonaService } from "../service"

describe("Agent personas public IPC contract", () => {
  it("manages user personas without exposing built-in personas as mutable records", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:agent-personas:list", undefined))
      .resolves.toMatchObject([
        { id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin", readonly: true },
      ])

    const created = await harness.invoke("synapse:agent-personas:create", {
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

    await expect(harness.invoke("synapse:agent-personas:list", undefined))
      .resolves.toMatchObject([
        { id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin", readonly: true },
        { id: created.id, name: "产品顾问", source: "user", readonly: false },
      ])

    await expect(harness.invoke("synapse:agent-personas:update", {
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

    await expect(harness.invoke("synapse:agent-personas:delete", { id: created.id }))
      .resolves.toBeUndefined()
    await expect(harness.invoke("synapse:agent-personas:list", undefined))
      .resolves.toMatchObject([
        { id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin", readonly: true },
      ])
  })

  it("rejects invalid public payloads at the IPC boundary", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:agent-personas:create", {
      name: "产品顾问",
      description: "整理产品判断。",
    })).rejects.toBeInstanceOf(IpcValidationError)

    await expect(harness.invoke("synapse:agent-personas:create", {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "invalid" },
    })).rejects.toBeInstanceOf(IpcValidationError)
  })

  it("rejects built-in mutations through public channels", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:agent-personas:update", {
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      name: "中英翻译",
      description: "修改描述。",
      systemPrompt: "修改提示词。",
      providerModel: null,
    })).rejects.toThrow("内置智能体不可编辑")

    await expect(harness.invoke("synapse:agent-personas:delete", {
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
    })).rejects.toThrow("内置智能体不可删除")
  })

  it("allows built-in model updates through the dedicated public channel", async () => {
    const harness = createBlackBoxHarness()

    await expect(harness.invoke("synapse:agent-personas:builtin-model:update", {
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })).resolves.toMatchObject({
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      source: "builtin",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })

    await expect(harness.invoke("synapse:agent-personas:list", undefined))
      .resolves.toMatchObject([
        {
          id: BUILTIN_ZH_EN_TRANSLATOR_ID,
          source: "builtin",
          providerModel: { providerId: "claude", modelTier: "sonnet" },
        },
      ])

    await expect(harness.invoke("synapse:agent-personas:update", {
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      name: "改名",
      description: "修改描述。",
      systemPrompt: "修改提示词。",
      providerModel: null,
    })).rejects.toThrow("内置智能体不可编辑")
  })

  it("broadcasts changed events after public mutations", async () => {
    const harness = createBlackBoxHarness()

    await harness.invoke("synapse:agent-personas:create", {
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
    })

    expect(harness.broadcast).toHaveBeenCalledWith(
      "synapse:agent-personas:changed",
      {
        items: expect.arrayContaining([
          expect.objectContaining({ id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin" }),
          expect.objectContaining({ name: "产品顾问", source: "user" }),
        ]),
      },
    )
  })
})

function createBlackBoxHarness() {
  const items = createMemoryNamespace<AgentPersonaItemEntryV1>()
  const settings = createMemorySingletonNamespace<AgentPersonaSettingsEntryV1>()
  const service = createAgentPersonaService({
    items,
    settings,
    now: () => new Date("2026-06-30T00:00:00.000Z"),
    createId: () => `persona-${items.records.size + 1}`,
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

function createMemoryNamespace<T extends { id: string }>(): DataNamespace<T> & { records: Map<string, T> } {
  const events = new EventEmitter()
  const records = new Map<string, T>()
  return {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite",
    records,
    async getSingleton() { return null },
    async setSingleton() {},
    async clearSingleton() {},
    async list() { return Array.from(records.values()) },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
}
