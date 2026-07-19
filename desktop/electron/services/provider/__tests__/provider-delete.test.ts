import { describe, expect, it } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import { ProviderService } from "../provider-service"
import { LOCAL_CLAUDE_CODE_PROVIDER_ID } from "../types"

describe("ProviderService.deleteProvider", () => {
  it("physically removes the provider record and its secret", async () => {
    const { service, providers, secrets } = makeProviderService()
    await service.createProvider({
      id: "to-delete",
      name: "Deletable",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-del",
      env: {},
    })
    await expect(providers.get("to-delete")).resolves.toBeTruthy()
    await expect(secrets.get("provider:to-delete:api-key")).resolves.toBeTruthy()

    await service.deleteProvider("to-delete")

    await expect(providers.get("to-delete")).resolves.toBeNull()
    await expect(secrets.get("provider:to-delete:api-key")).resolves.toBeNull()
  })

  it("rejects deleting the built-in local provider", async () => {
    const { service } = makeProviderService()
    await expect(service.deleteProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID))
      .rejects.toThrow("cannot be deleted")
  })

  it("rejects deleting provider that has active references", async () => {
    const { service } = makeProviderService({
      scanReferences: async () => ({
        providerId: "in-use",
        references: [
          { kind: "workflow-node", entityId: "wf1", entityName: "代码审查", nodeId: "n1", nodeName: "AI Review", providerId: "in-use", modelTier: "sonnet" },
        ],
        workflowNodeCount: 1,
        conversationCount: 0,
        agentPersonaCount: 0,
      }),
    })
    await service.createProvider({
      id: "in-use",
      name: "In Use",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-key",
      env: {},
    })
    await expect(service.deleteProvider("in-use"))
      .rejects.toThrow("无法删除：该供应商正在被 1 个工作流（代码审查） 使用")
  })

  it("rejects deleting provider that is specified by an agent persona", async () => {
    const { service } = makeProviderService({
      scanReferences: async () => ({
        providerId: "in-use",
        references: [
          { kind: "agent-persona", entityId: "persona-1", entityName: "中英翻译", providerId: "in-use", modelTier: "sonnet" },
        ],
        workflowNodeCount: 0,
        conversationCount: 0,
        agentPersonaCount: 1,
      }),
    })
    await service.createProvider({
      id: "in-use",
      name: "In Use",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })

    await expect(service.deleteProvider("in-use"))
      .rejects.toThrow("无法删除：该供应商正在被 1 个智能体（中英翻译） 使用")
  })

  it("switches active to local-claude-code before deleting active provider", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "active-one",
      name: "Active",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "active-one" })

    await service.deleteProvider("active-one")

    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: LOCAL_CLAUDE_CODE_PROVIDER_ID })
  })

  it("keeps the provider record when secret deletion fails", async () => {
    const { service, providers, secrets } = makeProviderService()
    await service.createProvider({
      id: "secret-fails",
      name: "Secret Fails",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-kept",
      env: {},
    })
    secrets.remove = async () => {
      throw new Error("secret store unavailable")
    }

    await expect(service.deleteProvider("secret-fails")).rejects.toThrow("secret store unavailable")

    await expect(providers.get("secret-fails")).resolves.toMatchObject({
      id: "secret-fails",
      secretRef: "provider:secret-fails:api-key",
    })
  })

  it("keeps the active provider selected when deleting its secret fails", async () => {
    const { service, secrets } = makeProviderService()
    await service.createProvider({
      id: "active-secret-fails",
      name: "Active Secret Fails",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-active-kept",
      active: true,
      env: {},
    })
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "active-secret-fails" })
    secrets.remove = async () => {
      throw new Error("secret store unavailable")
    }

    await expect(service.deleteProvider("active-secret-fails")).rejects.toThrow("secret store unavailable")

    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "active-secret-fails" })
  })
})

describe("ProviderService.listAllProviders", () => {
  it("includes archived providers", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "archived-one",
      name: "Archived",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    await service.archiveProvider("archived-one")

    const all = await service.listAllProviders()
    const regular = await service.listProviders()

    expect(all.some((p) => p.id === "archived-one")).toBe(true)
    expect(regular.some((p) => p.id === "archived-one")).toBe(false)
  })
})

describe("ProviderService.buildEnvSafe", () => {
  it("returns ok:true for existing provider", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "valid",
      name: "Valid",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-valid",
      env: {},
    })

    const result = await service.buildEnvSafe("valid")
    expect(result).toEqual({ ok: true, env: expect.objectContaining({ ANTHROPIC_API_KEY: "sk-valid" }) })
  })

  it("returns ok:false with not_found for missing provider", async () => {
    const { service } = makeProviderService()

    const result = await service.buildEnvSafe("nonexistent")
    expect(result).toEqual({ ok: false, reason: "not_found", message: expect.any(String) })
  })

  it("returns ok:true for archived provider (data still exists)", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "arch",
      name: "Arch",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    await service.archiveProvider("arch")

    const result = await service.buildEnvSafe("arch")
    expect(result).toEqual({ ok: true, env: expect.any(Object) })
  })
})

// ─── Test helpers (same pattern as provider-service.test.ts) ─────────────────

function makeProviderService(overrides?: Partial<Parameters<typeof ProviderService extends new (deps: infer D) => any ? (deps: D) => void : never>[0]>) {
  const providers = new MemoryNamespace<ProviderEntryV1>("providers")
  const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
  const service = new ProviderService({
    providers,
    secrets,
    now: () => new Date("2026-05-15T00:00:00.000Z"),
    ...overrides,
  })
  return { service, providers, secrets }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((value) =>
      Object.entries(filter).every(([key, expected]) =>
        (value as Record<string, unknown>)[key] === expected,
      ),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}
