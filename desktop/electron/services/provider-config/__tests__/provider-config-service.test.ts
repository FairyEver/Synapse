import { describe, expect, it } from "vitest"

import type {
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import { InMemoryAuditSink, createPermissionGuard } from "../../../runtime/security"
import { buildClaudeCodeArgs } from "../../agent-runtime"
import { ProviderConfigService } from "../provider-config-service"

describe("ProviderConfigService", () => {
  it("resolves provider refs, inline overrides, agent filtering, model, and mode", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

    await service.upsertGlobalProvider({
      id: "anthropic",
      kind: "anthropic",
      baseUrl: "https://global.example/v1",
      model: "claude-sonnet-4.5",
      models: [{ id: "claude-sonnet-4.5", alias: "main" }],
      agentTypes: ["claude-code"],
    })
    await service.upsertGlobalProvider({
      id: "anthropic-alt",
      kind: "anthropic",
      model: "claude-haiku-3.5",
      models: [{ id: "claude-haiku-3.5" }],
      agentTypes: ["claude-code"],
    })
    await service.setProjectProviderRefs("project-1", ["anthropic", "anthropic-alt"])
    await service.upsertProjectProvider("project-1", {
      id: "anthropic",
      kind: "anthropic",
      baseUrl: "https://inline.example/v1",
      model: "claude-sonnet-4.5-inline",
      models: [{ id: "claude-sonnet-4.5-inline", alias: "fast" }],
      agentTypes: ["claude-code"],
    })
    await service.setActiveProvider("project-1", "anthropic")
    await service.setActiveMode("project-1", "acceptEdits", "claude-code")

    const claudeState = await service.getProjectProviderState("project-1", "claude-code")
    expect(claudeState.providers.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["anthropic", "anthropic-alt"]),
    )
    expect(claudeState.providers).toHaveLength(2)
    expect(claudeState.activeProvider).toEqual(
      expect.objectContaining({
        id: "anthropic",
        scope: "project",
        baseUrl: "https://inline.example/v1",
        model: "claude-sonnet-4.5-inline",
      }),
    )
    expect(claudeState.activeModel).toBe("claude-sonnet-4.5-inline")
    expect(claudeState.activeMode).toBe("acceptEdits")

    expect(await service.getActiveAgentType("project-1")).toBe("claude-code")
  })

  it("resolves the active agent type from project state or a single-agent provider", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

    await service.upsertGlobalProvider({
      id: "anthropic",
      kind: "anthropic",
      model: "claude-sonnet",
      agentTypes: ["claude-code"],
    })
    await service.setProjectProviderRefs("project-1", ["anthropic"])
    await service.setActiveProvider("project-1", "anthropic")

    expect(await service.getActiveAgentType("project-1")).toBe("claude-code")

    await service.setActiveMode("project-1", "acceptEdits", "claude-code")
    expect(await service.getActiveAgentType("project-1")).toBe("claude-code")
  })

  it("updates active provider model first and project model when no provider is active", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

    await service.upsertGlobalProvider({
      id: "anthropic",
      model: "old-model",
      models: [{ id: "old-model" }, { id: "new-model", alias: "new" }],
      agentTypes: ["claude-code"],
    })
    await service.setProjectProviderRefs("project-1", ["anthropic"])
    await service.setActiveProvider("project-1", "anthropic")
    await service.setActiveModel("project-1", "new-model", "claude-code")

    expect((await service.getProjectProviderState("project-1", "claude-code")).activeModel).toBe("new-model")
    expect((await providers.get("anthropic"))?.activeModel).toBe("new-model")

    await service.setActiveProvider("project-1", null)
    await service.setActiveModel("project-1", "project-default", "claude-code")
    expect((await service.getProjectProviderState("project-1", "claude-code")).activeModel).toBe("project-default")
  })

  it("resolves secrets only into runtime env and keeps provider state secretRef-only", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const auditSink = new InMemoryAuditSink()
    const service = new ProviderConfigService({
      providers,
      secrets,
      permissionGuard: createPermissionGuard(),
      auditSink,
      now: fixedNow,
    })

    await secrets.upsert({
      id: "secret-anthropic",
      schemaVersion: 1,
      kind: "api-key",
      value: "sk-secret",
    })
    await service.upsertGlobalProvider({
      id: "anthropic",
      baseUrl: "https://api.example/v1",
      secretRef: "secret-anthropic",
      model: "claude-sonnet-4.5",
      agentTypes: ["claude-code"],
      env: { CUSTOM_PROVIDER_ENV: "enabled" },
    })
    await service.setProjectProviderRefs("project-1", ["anthropic"])
    await service.setActiveProvider("project-1", "anthropic")

    const state = await service.getProjectProviderState("project-1", "claude-code")
    expect(JSON.stringify(state)).not.toContain("sk-secret")
    expect(state.activeProvider?.secretRef).toBe("secret-anthropic")

    const runtime = await service.resolveRuntimeConfig("project-1", "claude-code")
    expect(runtime.apiKey).toBe("sk-secret")
    expect(runtime.env).toEqual(
      expect.objectContaining({
        ANTHROPIC_BASE_URL: "https://api.example/v1",
        ANTHROPIC_AUTH_TOKEN: "sk-secret",
        ANTHROPIC_API_KEY: "",
        CUSTOM_PROVIDER_ENV: "enabled",
      }),
    )
    expect(auditSink.list()).toEqual([
      expect.objectContaining({ action: "secret.read", outcome: "allowed", resource: "secret-anthropic" }),
    ])
  })

  it("maps Claude Code runtime view to env and args", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

    await secrets.upsert({
      id: "secret-anthropic",
      schemaVersion: 1,
      kind: "api-key",
      value: "anthropic-secret",
    })
    await service.upsertGlobalProvider({
      id: "anthropic",
      kind: "anthropic",
      baseUrl: "https://anthropic.example",
      secretRef: "secret-anthropic",
      model: "claude-sonnet",
      agentTypes: ["claude-code"],
      env: { CLAUDE_CODE_USE_BEDROCK: "0" },
    })
    await service.setProjectProviderRefs("project-1", ["anthropic"])
    await service.setActiveProvider("project-1", "anthropic")
    await service.setActiveMode("project-1", "acceptEdits", "claude-code")

    const runtime = await service.resolveRuntimeConfig("project-1", "claude-code")

    expect(runtime.env).toEqual(
      expect.objectContaining({
        ANTHROPIC_BASE_URL: "https://anthropic.example",
        ANTHROPIC_AUTH_TOKEN: "anthropic-secret",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_MODEL: "claude-sonnet",
        CLAUDE_CODE_USE_BEDROCK: "0",
      }),
    )
    expect(buildClaudeCodeArgs({
      model: runtime.model,
      mode: runtime.mode,
    })).toContain("claude-sonnet")
    expect(buildClaudeCodeArgs({
      model: runtime.model,
      mode: runtime.mode,
    })).toContain("acceptEdits")
  })

  it("fails clearly when resolving runtime config for an unknown Agent", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const service = new ProviderConfigService({ providers, secrets, now: fixedNow })

    await expect(service.resolveRuntimeConfig("project-1", "unknown-agent"))
      .rejects
      .toThrow("Unknown agent runtime: unknown-agent")
  })

  it("fails unknown runtime before reading an active provider secret", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const auditSink = new InMemoryAuditSink()
    const service = new ProviderConfigService({
      providers,
      secrets,
      permissionGuard: createPermissionGuard(),
      auditSink,
      now: fixedNow,
    })

    await secrets.upsert({
      id: "secret-openai",
      schemaVersion: 1,
      kind: "api-key",
      value: "sk-secret",
    })
    await service.upsertGlobalProvider({
      id: "openai",
      secretRef: "secret-openai",
      model: "gpt-5.4",
      agentTypes: ["unknown-agent"],
    })
    await service.setProjectProviderRefs("project-1", ["openai"])
    await service.setActiveProvider("project-1", "openai")

    await expect(service.resolveRuntimeConfig("project-1", "unknown-agent"))
      .rejects
      .toThrow("Unknown agent runtime: unknown-agent")
    expect(auditSink.list().filter((entry) => entry.action === "secret.read")).toEqual([])
  })
})

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
  return new Date("2026-04-26T00:00:00.000Z")
}
