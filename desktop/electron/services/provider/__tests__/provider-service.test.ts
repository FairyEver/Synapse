import { describe, expect, it } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import {
  InMemoryAuditSink,
  createPermissionGuard,
} from "../../../runtime/security"
import type {
  AuditSink,
  PermissionGuard,
} from "../../../runtime/security"
import { ProviderService } from "../provider-service"
import { LOCAL_CLAUDE_CODE_PROVIDER_ID } from "../types"

describe("ProviderService", () => {
  it("exposes local Claude Code as the default read-only provider", async () => {
    const { service } = makeProviderService({
      localClaudeSettingsPath: "/Users/test/.claude/settings.json",
      readTextFile: async () => JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://api.example.test",
          ANTHROPIC_AUTH_TOKEN: "sk-hidden",
          ANTHROPIC_MODEL: "claude-sonnet-4-5",
          ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-3-5",
        },
      }),
    })

    await expect(service.listProviders()).resolves.toEqual([
      expect.objectContaining({
        id: LOCAL_CLAUDE_CODE_PROVIDER_ID,
        name: "本机 Claude Code",
        source: "local",
        readonly: true,
        active: true,
        configured: true,
        configPath: "/Users/test/.claude/settings.json",
        baseUrl: "https://api.example.test",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "claude-sonnet-4-5",
        haikuModel: "claude-haiku-3-5",
        env: {},
      }),
    ])
    await expect(service.getActiveProvider()).resolves.toMatchObject({
      id: LOCAL_CLAUDE_CODE_PROVIDER_ID,
      active: true,
    })
    await expect(service.buildEnv(LOCAL_CLAUDE_CODE_PROVIDER_ID)).resolves.toEqual({})
  })

  it("lets user providers override and then clear the active provider", async () => {
    const { service, providers } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })

    await expect(service.listProviders()).resolves.toEqual([
      expect.objectContaining({
        id: LOCAL_CLAUDE_CODE_PROVIDER_ID,
        active: false,
      }),
      expect.objectContaining({
        id: "anthropic",
        active: true,
      }),
    ])

    await service.setActiveProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID)

    await expect(providers.get("anthropic")).resolves.toMatchObject({
      active: false,
    })
    await expect(service.getActiveProvider()).resolves.toMatchObject({
      id: LOCAL_CLAUDE_CODE_PROVIDER_ID,
      active: true,
    })
  })

  it("rejects mutating the built-in local Claude Code provider", async () => {
    const { service } = makeProviderService()

    await expect(service.createProvider({
      id: LOCAL_CLAUDE_CODE_PROVIDER_ID,
      name: "Local",
      category: "official",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      env: {},
    })).rejects.toThrow("built in")
    await expect(service.updateProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID, {
      name: "Changed",
    })).rejects.toThrow("cannot be edited")
    await expect(service.archiveProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID)).rejects.toThrow("cannot be archived")
  })

  it("stores API keys only in the encrypted secrets namespace", async () => {
    const { service, providers, secrets } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })

    await expect(service.buildEnv("anthropic")).resolves.toMatchObject({
      ANTHROPIC_API_KEY: "sk-test",
    })
    await expect(providers.get("anthropic")).resolves.toMatchObject({
      secretRef: "provider:anthropic:api-key",
    })
    await expect(secrets.get("provider:anthropic:api-key")).resolves.toMatchObject({
      kind: "api-key",
      value: "sk-test",
    })
  })

  it("uses ANTHROPIC_AUTH_TOKEN for baseUrl providers", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "deepseek",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "token",
      model: "deepseek-chat",
      env: {},
    })

    await expect(service.buildEnv("deepseek")).resolves.toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "deepseek-chat",
    })
  })

  it("builds default model env vars from provider model fields", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      env: {},
    })
    await service.updateProvider("anthropic", {
      haikuModel: "claude-haiku-3-5",
      sonnetModel: "claude-sonnet-4-5",
      opusModel: "claude-opus-4-1",
    })

    await expect(service.buildEnv("anthropic")).resolves.toMatchObject({
      ANTHROPIC_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-3-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-1",
    })
  })

  it("denies secret env reads through PermissionGuard and records audit", async () => {
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({ permissionGuard, auditSink })

    permissionGuard.registerPolicy({
      id: "deny-provider-secret",
      decide: (request) => request.action === "secret.read" ? "deny" : "defer-to-next",
    })
    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })

    await expect(service.buildEnv("anthropic", {
      actor: { kind: "agent", id: "agent-1" },
      projectId: "project-1",
    })).rejects.toThrow("denied by deny-provider-secret")
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.read",
        outcome: "denied",
        resource: "provider:anthropic:api-key",
        metadata: expect.objectContaining({
          providerId: "anthropic",
          projectId: "project-1",
          policyId: "deny-provider-secret",
          reason: "denied by deny-provider-secret",
        }),
      }),
    ])
  })

  it("redacts secret read failure audit diagnostics", async () => {
    const auditSink = new InMemoryAuditSink()
    const { service, secrets } = makeProviderService({ auditSink })
    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })
    const rawError = "secret store failed with token=sk-raw and /Users/test/.claude/settings.json"
    secrets.get = async () => {
      throw new Error(rawError)
    }

    await expect(service.buildEnv("anthropic", {
      actor: { kind: "agent", id: "agent-1" },
      projectId: "project-1",
    })).rejects.toThrow(rawError)

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.read",
        outcome: "failed",
        resource: "provider:anthropic:api-key",
        metadata: expect.objectContaining({
          providerId: "anthropic",
          projectId: "project-1",
          errorName: "Error",
          errorLength: rawError.length,
        }),
      }),
    ])
    expect(JSON.stringify(auditSink.list())).not.toContain("sk-raw")
    expect(JSON.stringify(auditSink.list())).not.toContain("/Users/test")
  })

  it("rejects activating an archived provider", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })
    await service.createProvider({
      id: "archived",
      name: "Archived",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    await service.archiveProvider("archived")

    await expect(service.setActiveProvider("archived")).rejects.toThrow("Cannot activate archived provider: archived")
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "anthropic" })
  })

  it("rejects updating a provider to active and archived", async () => {
    const { service, providers } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })

    await expect(service.updateProvider("anthropic", {
      active: true,
      archived: true,
    })).rejects.toThrow("Provider cannot be active and archived: anthropic")
    await expect(providers.get("anthropic")).resolves.not.toMatchObject({
      active: true,
      archived: true,
    })
  })
})

function makeProviderService(deps: {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly localClaudeSettingsPath?: string
  readonly readTextFile?: (filePath: string) => Promise<string>
} = {}) {
  const providers = new MemoryNamespace<ProviderEntryV1>("providers")
  const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
  const service = new ProviderService({
    providers,
    secrets,
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    localClaudeSettingsPath: deps.localClaudeSettingsPath,
    readTextFile: deps.readTextFile,
    now: fixedNow,
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

function fixedNow(): Date {
  return new Date("2026-05-13T00:00:00.000Z")
}
