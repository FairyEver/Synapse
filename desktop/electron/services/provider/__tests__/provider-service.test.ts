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
import {
  LOCAL_CLAUDE_CODE_PROVIDER_ID,
  type CcSwitchClaudeProviderImportCandidate,
  type CcSwitchImportSource,
} from "../types"

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
      ANTHROPIC_AUTH_TOKEN: "",
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

  it("stores sensitive provider env values in encrypted secret refs", async () => {
    const { service, providers, secrets } = makeProviderService()

    await service.createProvider({
      id: "bedrock-aksk",
      name: "AWS Bedrock (AKSK)",
      category: "cloud_provider",
      baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {
        AWS_REGION: "us-west-2",
        AWS_ACCESS_KEY_ID: "AKIA_TEST",
        CLAUDE_CODE_USE_BEDROCK: "1",
      },
      secretEnv: {
        AWS_SECRET_ACCESS_KEY: "secret-access-key",
      },
    })

    await expect(service.buildEnv("bedrock-aksk")).resolves.toMatchObject({
      AWS_REGION: "us-west-2",
      AWS_ACCESS_KEY_ID: "AKIA_TEST",
      AWS_SECRET_ACCESS_KEY: "secret-access-key",
      CLAUDE_CODE_USE_BEDROCK: "1",
    })
    await expect(providers.get("bedrock-aksk")).resolves.toMatchObject({
      secretEnvRefs: {
        AWS_SECRET_ACCESS_KEY: "provider:bedrock-aksk:env:AWS_SECRET_ACCESS_KEY",
      },
    })
    await expect(secrets.get("provider:bedrock-aksk:env:AWS_SECRET_ACCESS_KEY")).resolves.toMatchObject({
      kind: "generic",
      value: "secret-access-key",
    })
  })

  it("does not require secret write permission when creating provider metadata without secrets", async () => {
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service, providers } = makeProviderService({ permissionGuard, auditSink })

    permissionGuard.registerPolicy({
      id: "deny-secret-write",
      decide: (request) => request.action === "secret.write" ? "deny" : "defer-to-next",
    })

    await service.createProvider({
      id: "metadata-only",
      name: "Metadata Only",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })

    await expect(providers.get("metadata-only")).resolves.toMatchObject({
      id: "metadata-only",
      secretRef: "provider:metadata-only:api-key",
    })
    expect(auditSink.list().filter((r) => r.action === "secret.write")).toEqual([])
  })

  it("denies provider secret creation through PermissionGuard and records audit", async () => {
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service, providers, secrets } = makeProviderService({ permissionGuard, auditSink })

    permissionGuard.registerPolicy({
      id: "deny-secret-write",
      decide: (request) => request.action === "secret.write" ? "deny" : "defer-to-next",
    })

    await expect(service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })).rejects.toThrow("denied by deny-secret-write")

    await expect(providers.get("anthropic")).resolves.toBeNull()
    await expect(secrets.get("provider:anthropic:api-key")).resolves.toBeNull()
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "denied",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "create",
          providerId: "anthropic",
          policyId: "deny-secret-write",
        }),
      }),
    ])
  })

  it("denies provider secret updates through PermissionGuard and records audit", async () => {
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service, providers, secrets } = makeProviderService({ permissionGuard, auditSink })

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    permissionGuard.registerPolicy({
      id: "deny-secret-write",
      decide: (request) => request.action === "secret.write" ? "deny" : "defer-to-next",
    })

    await expect(service.updateProvider("anthropic", {
      apiKey: "sk-test",
    })).rejects.toThrow("denied by deny-secret-write")

    await expect(providers.get("anthropic")).resolves.toMatchObject({
      id: "anthropic",
      secretRef: "provider:anthropic:api-key",
    })
    await expect(secrets.get("provider:anthropic:api-key")).resolves.toBeNull()
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "denied",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "update",
          providerId: "anthropic",
          policyId: "deny-secret-write",
        }),
      }),
    ])
  })

  it("denies provider secret deletion through PermissionGuard and records audit", async () => {
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service, providers, secrets } = makeProviderService({ permissionGuard, auditSink })

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      env: {},
    })
    auditSink.clearForTests()
    permissionGuard.registerPolicy({
      id: "deny-secret-write",
      decide: (request) => request.action === "secret.write" ? "deny" : "defer-to-next",
    })

    await expect(service.deleteProvider("anthropic")).rejects.toThrow("denied by deny-secret-write")

    await expect(providers.get("anthropic")).resolves.toMatchObject({
      id: "anthropic",
      secretRef: "provider:anthropic:api-key",
    })
    await expect(secrets.get("provider:anthropic:api-key")).resolves.toMatchObject({
      value: "sk-test",
    })
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "denied",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "delete",
          providerId: "anthropic",
          policyId: "deny-secret-write",
        }),
      }),
    ])
  })

  it("lists public supported provider presets", async () => {
    const { service } = makeProviderService()

    await expect(service.listProviderPresets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "PackyCode",
          category: "third_party",
          baseUrl: "https://www.packyapi.com",
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        }),
        expect.objectContaining({
          name: "AWS Bedrock (AKSK)",
          category: "cloud_provider",
          templateValues: expect.arrayContaining([
            expect.objectContaining({ key: "AWS_REGION" }),
            expect.objectContaining({ key: "AWS_SECRET_ACCESS_KEY", sensitive: true }),
          ]),
        }),
      ]),
    )
    const names = (await service.listProviderPresets()).map((preset) => preset.name)
    expect(names).not.toContain("GitHub Copilot")
    expect(names).not.toContain("Codex")
  })

  it("creates a provider from a preset through the existing provider path", async () => {
    const { service } = makeProviderService()

    const provider = await service.createProviderFromPreset({
      presetName: "PackyCode",
      apiKey: "sk-packy",
      active: true,
    })

    expect(provider).toMatchObject({
      id: "packycode",
      name: "PackyCode",
      category: "third_party",
      active: true,
      baseUrl: "https://www.packyapi.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    })
    await expect(service.buildEnv("packycode")).resolves.toMatchObject({
      ANTHROPIC_BASE_URL: "https://www.packyapi.com",
      ANTHROPIC_AUTH_TOKEN: "sk-packy",
      ANTHROPIC_API_KEY: "",
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

  it("round-trips provider metadata and extra env through create and update", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "extra-env-provider",
      name: "Extra Env Provider",
      note: "Company account",
      websiteUrl: "https://example.com",
      category: "custom",
      baseUrl: "https://api.example.com",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "sk-extra",
      env: {
        ENABLE_TOOL_SEARCH: "true",
      },
    })

    await expect(service.getProvider("extra-env-provider")).resolves.toMatchObject({
      note: "Company account",
      websiteUrl: "https://example.com",
      env: {
        ENABLE_TOOL_SEARCH: "true",
      },
    })

    await service.updateProvider("extra-env-provider", {
      note: "Team account",
      websiteUrl: "https://docs.example.com",
      env: {
        ENABLE_TOOL_SEARCH: "false",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      },
    })

    await expect(service.getProvider("extra-env-provider")).resolves.toMatchObject({
      note: "Team account",
      websiteUrl: "https://docs.example.com",
    })
    await expect(service.buildEnv("extra-env-provider")).resolves.toMatchObject({
      ENABLE_TOOL_SEARCH: "false",
      CLAUDE_CODE_EFFORT_LEVEL: "max",
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
    expect(auditSink.list().filter((r) => r.action === "secret.read")).toEqual([
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

    expect(auditSink.list().filter((r) => r.action === "secret.read")).toEqual([
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

  it("previews CC Switch Claude providers from the first readable source", async () => {
    const source = ccSwitchSource("/Users/test/.cc-switch/cc-switch.db")
    const { service } = makeProviderService({
      ccSwitchImportSources: () => [source],
      readCcSwitchClaudeProviders: async () => ({
        kind: "sqlite",
        providers: [ccSwitchCandidate("deepseek")],
      }),
    })
    await service.createProvider({
      id: "deepseek",
      name: "DeepSeek Existing",
      category: "cn_official",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      env: {},
    })

    await expect(service.previewCcSwitchClaudeProviders()).resolves.toEqual({
      source,
      items: [
        expect.objectContaining({
          id: "deepseek",
          status: "duplicate",
          selectedByDefault: false,
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        }),
      ],
    })
  })

  it("imports selected ready CC Switch Claude providers through the normal provider path", async () => {
    const source = ccSwitchSource("/Users/test/.cc-switch/cc-switch.db")
    const { service, secrets } = makeProviderService({
      ccSwitchImportSources: () => [source],
      readCcSwitchClaudeProviders: async () => ({
        kind: "sqlite",
        providers: [
          ccSwitchCandidate("deepseek"),
          ccSwitchCandidate("missing-key", { env: { ANTHROPIC_BASE_URL: "https://example.com" } }),
        ],
      }),
    })

    const result = await service.importCcSwitchClaudeProviders({
      source,
      providerIds: ["deepseek", "missing-key"],
    })

    expect(result.imported).toEqual([
      expect.objectContaining({
        id: "deepseek",
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-chat",
        env: {},
        settingsConfig: expect.objectContaining({
          env: expect.not.objectContaining({
            ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
          }),
        }),
      }),
    ])
    expect(result.skipped).toEqual([
      expect.objectContaining({
        id: "missing-key",
        status: "missing_api_key",
      }),
    ])
    await expect(secrets.get("provider:deepseek:api-key")).resolves.toMatchObject({
      value: "sk-deepseek",
    })
    expect(JSON.stringify(result.imported)).not.toContain("sk-deepseek")
  })

  it("denies CC Switch import source reads through PermissionGuard and records audit", async () => {
    const source = ccSwitchSource("/Users/test/.cc-switch/cc-switch.db")
    const permissionGuard = createPermissionGuard()
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({
      permissionGuard,
      auditSink,
      ccSwitchImportSources: () => [source],
      readCcSwitchClaudeProviders: async () => ({
        kind: "sqlite",
        providers: [ccSwitchCandidate("deepseek")],
      }),
    })

    permissionGuard.registerPolicy({
      id: "deny-cc-switch",
      decide: (request) => request.action === "fs.read.outside-userdata" ? "deny" : "defer-to-next",
    })

    await expect(service.previewCcSwitchClaudeProviders(source, {
      actor: { kind: "agent", id: "agent-1" },
      projectId: "project-1",
    })).rejects.toThrow("denied by deny-cc-switch")
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "denied",
        resource: source.path,
        metadata: expect.objectContaining({
          projectId: "project-1",
          sourceKind: "sqlite",
          policyId: "deny-cc-switch",
        }),
      }),
    ])
  })
})

function makeProviderService(deps: {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly localClaudeSettingsPath?: string
  readonly readTextFile?: (filePath: string) => Promise<string>
  readonly ccSwitchImportSources?: () => readonly CcSwitchImportSource[]
  readonly readCcSwitchClaudeProviders?: (source: CcSwitchImportSource) => Promise<{
    readonly kind: CcSwitchImportSource["kind"]
    readonly providers: readonly CcSwitchClaudeProviderImportCandidate[]
  }>
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
    ccSwitchImportSources: deps.ccSwitchImportSources,
    readCcSwitchClaudeProviders: deps.readCcSwitchClaudeProviders,
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

function ccSwitchSource(filePath: string): CcSwitchImportSource {
  return { kind: "sqlite", path: filePath }
}

function ccSwitchCandidate(
  id: string,
  settingsConfig: Record<string, unknown> = {
    env: {
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-deepseek",
      ANTHROPIC_MODEL: "deepseek-chat",
    },
  },
): CcSwitchClaudeProviderImportCandidate {
  return {
    id,
    name: id === "deepseek" ? "DeepSeek" : "Missing Key",
    category: id === "deepseek" ? "cn_official" : "custom",
    websiteUrl: id === "deepseek" ? "https://platform.deepseek.com" : undefined,
    settingsConfig,
  }
}
