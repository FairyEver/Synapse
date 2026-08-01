import { describe, expect, it, vi } from "vitest"

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
  buildProviderPackage,
  parseProviderPackage,
  resolveProviderPackageTargetId,
} from "../provider-package"
import {
  LOCAL_CLAUDE_CODE_PROVIDER_ID,
  type CcSwitchClaudeProviderImportCandidate,
  type CcSwitchImportSource,
} from "../types"

describe("ProviderService", () => {
  it("builds provider packages without local machine state", () => {
    const pkg = buildProviderPackage({
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        source: "user",
        readonly: false,
        configured: true,
        configPath: "/Users/test/config.json",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        active: true,
        model: "deepseek-chat",
        env: { CLAUDE_CODE_USE_VERTEX: "1" },
        settingsConfig: { env: { ANTHROPIC_MODEL: "deepseek-chat" } },
        archived: true,
        sortIndex: 7,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
      apiKey: "sk-deepseek",
      secretEnv: { AWS_SECRET_ACCESS_KEY: "secret-access-key" },
    })

    expect(pkg).toEqual({
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        env: { CLAUDE_CODE_USE_VERTEX: "1" },
        settingsConfig: { env: { ANTHROPIC_MODEL: "deepseek-chat" } },
      },
      secrets: {
        apiKey: "sk-deepseek",
        env: { AWS_SECRET_ACCESS_KEY: "secret-access-key" },
      },
    })
    expect(JSON.stringify(pkg)).not.toContain("configPath")
    expect(JSON.stringify(pkg)).not.toContain("sortIndex")
    expect(JSON.stringify(pkg)).not.toContain("active")
  })

  it("parses provider package v1 and rejects unsupported shapes", () => {
    const valid = {
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      },
      secrets: { apiKey: "sk-deepseek", env: {} },
    }

    expect(parseProviderPackage(valid)).toEqual(valid)
    expect(() => parseProviderPackage({ ...valid, version: 2 })).toThrow("不支持的配置版本")
    expect(() => parseProviderPackage({ ...valid, kind: "other" })).toThrow("无法识别该文件")
    expect(() => parseProviderPackage({ ...valid, secrets: {} })).toThrow("配置不完整")
    expect(() => parseProviderPackage({ ...valid, provider: { ...valid.provider, source: "local" } })).toThrow("不支持导入内置供应商")
  })

  it("derives the next provider package target id", () => {
    expect(resolveProviderPackageTargetId("deepseek", new Set(["deepseek", "deepseek-2"]))).toBe("deepseek-3")
    expect(resolveProviderPackageTargetId("packy", new Set(["deepseek"]))).toBe("packy")
  })

  it("exposes local CC/Synapse as the default read-only provider", async () => {
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
        name: "CC/Synapse",
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

  it("rolls back active provider changes when switching providers fails midway", async () => {
    const { service, providers } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })
    await service.createProvider({
      id: "deepseek",
      name: "DeepSeek",
      category: "cn_official",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      env: {},
    })

    const originalUpsert = providers.upsert.bind(providers)
    let upsertCount = 0
    vi.spyOn(providers, "upsert").mockImplementation(async (item) => {
      upsertCount += 1
      if (upsertCount === 2) {
        throw new Error("provider metadata write failed")
      }
      await originalUpsert(item)
    })

    await expect(service.setActiveProvider("deepseek")).rejects.toThrow("provider metadata write failed")
    const allProviders = await service.listAllProviders()
    expect(allProviders.find((provider) => provider.id === "anthropic")).toMatchObject({ active: true })
    expect(allProviders.find((provider) => provider.id === "deepseek")?.active).not.toBe(true)
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "anthropic" })
  })

  it("rolls back active provider clearing when switching to local provider fails", async () => {
    const { service, providers } = makeProviderService()

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })

    const originalUpsert = providers.upsert.bind(providers)
    let upsertCount = 0
    vi.spyOn(providers, "upsert").mockImplementation(async (item) => {
      upsertCount += 1
      if (upsertCount === 1) {
        throw new Error("provider metadata write failed")
      }
      await originalUpsert(item)
    })

    await expect(service.setActiveProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID)).rejects.toThrow("provider metadata write failed")
    await expect(providers.get("anthropic")).resolves.toMatchObject({ active: true })
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "anthropic" })
  })

  it("rejects mutating the built-in local CC/Synapse provider", async () => {
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

  it("removes newly written provider secrets when metadata creation fails", async () => {
    const auditSink = new InMemoryAuditSink()
    const { service, providers, secrets } = makeProviderService({ auditSink })
    const originalUpsert = providers.upsert.bind(providers)
    vi.spyOn(providers, "upsert").mockImplementation(async (item) => {
      if (item.id === "orphaned") {
        throw new Error("provider metadata write failed")
      }
      await originalUpsert(item)
    })

    await expect(service.createProvider({
      id: "orphaned",
      name: "Orphaned Provider",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-orphaned",
      secretEnv: {
        CUSTOM_TOKEN: "orphaned-token",
      },
      env: {},
    })).rejects.toThrow("provider metadata write failed")

    await expect(providers.get("orphaned")).resolves.toBeNull()
    await expect(secrets.get("provider:orphaned:api-key")).resolves.toBeNull()
    await expect(secrets.get("provider:orphaned:env:CUSTOM_TOKEN")).resolves.toBeNull()
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "failed",
        resource: "provider:orphaned",
        metadata: expect.objectContaining({
          operation: "create",
          providerId: "orphaned",
          errorName: "Error",
        }),
      }),
    ])
    expect(JSON.stringify(auditSink.list())).not.toContain("sk-orphaned")
    expect(JSON.stringify(auditSink.list())).not.toContain("orphaned-token")
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

  it("restores provider secrets when metadata update fails", async () => {
    const auditSink = new InMemoryAuditSink()
    const { service, providers, secrets } = makeProviderService({ auditSink })

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-old",
      secretEnv: {
        CUSTOM_TOKEN: "old-token",
      },
      env: {},
    })
    auditSink.clearForTests()
    const originalUpsert = providers.upsert.bind(providers)
    providers.upsert = async (item) => {
      if (item.id === "anthropic") {
        throw new Error("provider metadata write failed")
      }
      await originalUpsert(item)
    }

    await expect(service.updateProvider("anthropic", {
      apiKey: "sk-new",
      secretEnv: {
        CUSTOM_TOKEN: "new-token",
      },
    })).rejects.toThrow("provider metadata write failed")

    await expect(secrets.get("provider:anthropic:api-key")).resolves.toMatchObject({
      value: "sk-old",
    })
    await expect(secrets.get("provider:anthropic:env:CUSTOM_TOKEN")).resolves.toMatchObject({
      value: "old-token",
    })
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "failed",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "update",
          providerId: "anthropic",
          errorName: "Error",
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

  it("audits allowed provider secret creation without raw secret values", async () => {
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({ auditSink })

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-test",
      secretEnv: {
        CUSTOM_TOKEN: "secret-token",
      },
      env: {},
    })

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "allowed",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "create",
          providerId: "anthropic",
          secretRef: "provider:anthropic:api-key",
          secretEnvRefs: {
            CUSTOM_TOKEN: "provider:anthropic:env:CUSTOM_TOKEN",
          },
        }),
      }),
    ])
    const serialized = JSON.stringify(auditSink.list())
    expect(serialized).not.toContain("sk-test")
    expect(serialized).not.toContain("secret-token")
  })

  it("audits allowed provider secret update and deletion with secret env refs", async () => {
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({ auditSink })

    await service.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-old",
      secretEnv: {
        CUSTOM_TOKEN: "old-token",
      },
      env: {},
    })
    auditSink.clearForTests()

    await service.updateProvider("anthropic", {
      apiKey: "sk-new",
      secretEnv: {
        CUSTOM_TOKEN: "new-token",
      },
    })
    await service.deleteProvider("anthropic")

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "secret.write",
        outcome: "allowed",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "update",
          providerId: "anthropic",
          secretRef: "provider:anthropic:api-key",
          secretEnvRefs: {
            CUSTOM_TOKEN: "provider:anthropic:env:CUSTOM_TOKEN",
          },
        }),
      }),
      expect.objectContaining({
        action: "secret.write",
        outcome: "allowed",
        resource: "provider:anthropic",
        metadata: expect.objectContaining({
          operation: "delete",
          providerId: "anthropic",
          secretRef: "provider:anthropic:api-key",
          secretEnvRefs: {
            CUSTOM_TOKEN: "provider:anthropic:env:CUSTOM_TOKEN",
          },
        }),
      }),
    ])
    const serialized = JSON.stringify(auditSink.list())
    expect(serialized).not.toContain("sk-old")
    expect(serialized).not.toContain("sk-new")
    expect(serialized).not.toContain("old-token")
    expect(serialized).not.toContain("new-token")
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

  it("keeps structured provider Anthropic env ahead of extra env", async () => {
    const { service } = makeProviderService()

    await service.createProvider({
      id: "deepseek",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      apiKey: "token",
      model: "deepseek-chat",
      env: {
        ANTHROPIC_BASE_URL: "https://stale.example.test/anthropic",
        ANTHROPIC_MODEL: "stale-model",
        ENABLE_TOOL_SEARCH: "false",
      },
    })

    await expect(service.buildEnv("deepseek")).resolves.toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "deepseek-chat",
      ENABLE_TOOL_SEARCH: "false",
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

  it("rejects setting an archived provider active", async () => {
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

    await expect(service.setActiveProvider("archived")).rejects.toThrow("Cannot set archived provider active: archived")
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

  it("records failed audit when CC Switch source reading fails", async () => {
    const source = ccSwitchSource("/Users/test/.cc-switch/cc-switch.db")
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({
      auditSink,
      ccSwitchImportSources: () => [source],
      readCcSwitchClaudeProviders: async () => {
        throw new Error("sqlite read failed token=sk-secret")
      },
    })

    await expect(service.previewCcSwitchClaudeProviders(source, {
      actor: { kind: "agent", id: "agent-1" },
      projectId: "project-1",
    })).rejects.toThrow("sqlite read failed token=sk-secret")

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "allowed",
        resource: source.path,
      }),
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: source.path,
        metadata: expect.objectContaining({
          projectId: "project-1",
          sourceKind: "sqlite",
          errorName: "Error",
          errorLength: "Error: sqlite read failed token=sk-secret".length,
        }),
      }),
    ])
  })

  it("exports a user provider package with api key and secret env", async () => {
    const writes: Record<string, string> = {}
    const { service } = makeProviderService({
      writeTextFile: async (filePath, contents) => {
        writes[filePath] = contents
      },
    })
    await service.createProvider({
      id: "bedrock",
      name: "AWS Bedrock",
      category: "cloud_provider",
      baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-bedrock",
      env: { AWS_REGION: "us-west-2" },
      secretEnv: { AWS_SECRET_ACCESS_KEY: "secret-access-key" },
    })

    const result = await service.exportProviderPackage("bedrock", "/Users/test/bedrock.synapse-provider.json")

    expect(result).toEqual({ filePath: "/Users/test/bedrock.synapse-provider.json" })
    const pkg = JSON.parse(writes["/Users/test/bedrock.synapse-provider.json"])
    expect(pkg).toMatchObject({
      kind: "synapse.provider.package",
      version: 1,
      provider: {
        id: "bedrock",
        name: "AWS Bedrock",
        env: { AWS_REGION: "us-west-2" },
      },
      secrets: {
        apiKey: "sk-bedrock",
        env: { AWS_SECRET_ACCESS_KEY: "secret-access-key" },
      },
    })
  })

  it("rejects exporting the built-in provider", async () => {
    const { service } = makeProviderService()

    await expect(service.exportProviderPackage(
      LOCAL_CLAUDE_CODE_PROVIDER_ID,
      "/Users/test/local.synapse-provider.json",
    )).rejects.toThrow("不支持导出内置供应商")
  })

  it("previews provider package import without writing data", async () => {
    const packageText = JSON.stringify({
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
      },
      secrets: { apiKey: "sk-deepseek", env: {} },
    })
    const { service, providers, secrets } = makeProviderService({
      readTextFile: async () => packageText,
    })
    await service.createProvider({
      id: "deepseek",
      name: "Existing DeepSeek",
      category: "cn_official",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      env: {},
    })

    await expect(service.previewProviderPackageImport("/Users/test/deepseek.synapse-provider.json")).resolves.toEqual({
      sourcePath: "/Users/test/deepseek.synapse-provider.json",
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      packageVersion: 1,
      sourceProviderId: "deepseek",
      targetProviderId: "deepseek-2",
      name: "DeepSeek",
      category: "cn_official",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      model: "deepseek-chat",
    })
    await expect(providers.get("deepseek-2")).resolves.toBeNull()
    await expect(secrets.get("provider:deepseek-2:api-key")).resolves.toBeNull()
  })

  it("rejects oversized provider packages before reading them", async () => {
    const readTextFile = vi.fn(async () => "{}")
    const auditSink = new InMemoryAuditSink()
    const { service } = makeProviderService({
      auditSink,
      readTextFile,
      statFile: async () => ({ size: 1024 * 1024 + 1 }),
    })

    await expect(service.previewProviderPackageImport(
      "/Users/test/huge.synapse-provider.json",
      { actor: { kind: "user", id: "renderer" }, projectId: "project-1" },
    )).rejects.toThrow("Provider 包文件过大。")

    expect(readTextFile).not.toHaveBeenCalled()
    expect(auditSink.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "allowed",
        resource: "/Users/test/huge.synapse-provider.json",
      }),
      expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: "/Users/test/huge.synapse-provider.json",
        metadata: expect.objectContaining({
          packageKind: "synapse.provider.package",
          projectId: "project-1",
          errorName: "Error",
        }),
      }),
    ]))
  })

  it("rejects provider package text that exceeds the read size limit", async () => {
    const { service } = makeProviderService({
      readTextFile: async () => " ".repeat(1024 * 1024 + 1),
      statFile: async () => ({ size: 1 }),
    })

    await expect(service.previewProviderPackageImport("/Users/test/huge.synapse-provider.json"))
      .rejects
      .toThrow("Provider 包文件过大。")
  })

  it("rejects provider package import when the file changed after preview", async () => {
    const originalPackageText = JSON.stringify({
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
      },
      secrets: { apiKey: "sk-deepseek", env: {} },
    })
    const replacedPackageText = JSON.stringify({
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "other",
        name: "Other Provider",
        category: "custom",
        baseUrl: "https://example.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "other-model",
      },
      secrets: { apiKey: "sk-other", env: {} },
    })
    let packageText = originalPackageText
    const { service, providers } = makeProviderService({
      readTextFile: async () => packageText,
    })

    const preview = await service.previewProviderPackageImport("/Users/test/deepseek.synapse-provider.json")
    packageText = replacedPackageText

    await expect(service.importProviderPackage(
      "/Users/test/deepseek.synapse-provider.json",
      { contentSha256: preview.contentSha256 },
    )).rejects.toThrow("Provider 包已变更，请重新预览后再导入。")
    await expect(providers.get("other")).resolves.toBeNull()
  })

  it("imports provider package as inactive provider with a derived id", async () => {
    const packageText = JSON.stringify({
      kind: "synapse.provider.package",
      version: 1,
      exportedAt: "2026-06-03T00:00:00.000Z",
      provider: {
        id: "deepseek",
        name: "DeepSeek",
        category: "cn_official",
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKeyField: "ANTHROPIC_AUTH_TOKEN",
        model: "deepseek-chat",
        env: {
          EXTRA_FLAG: "1",
          OPENAI_API_KEY: "sk-plain",
          GITHUB_TOKEN: "ghp_plain",
        },
        settingsConfig: {
          env: {
            SAFE_FLAG: "1",
            CUSTOM_SECRET: "plain-secret",
          },
        },
      },
      secrets: {
        apiKey: "sk-deepseek",
        env: { AWS_SECRET_ACCESS_KEY: "secret-access-key" },
      },
    })
    const { service, secrets } = makeProviderService({
      readTextFile: async () => packageText,
    })
    await service.createProvider({
      id: "deepseek",
      name: "Existing DeepSeek",
      category: "cn_official",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      active: true,
      env: {},
    })

    const result = await service.importProviderPackage("/Users/test/deepseek.synapse-provider.json")

    expect(result.provider).toEqual(expect.objectContaining({
      id: "deepseek-2",
      name: "DeepSeek",
      active: false,
      env: { EXTRA_FLAG: "1" },
      settingsConfig: { env: { SAFE_FLAG: "1" } },
    }))
    await expect(secrets.get("provider:deepseek-2:api-key")).resolves.toMatchObject({ value: "sk-deepseek" })
    await expect(secrets.get("provider:deepseek-2:env:OPENAI_API_KEY")).resolves.toMatchObject({ value: "sk-plain" })
    await expect(secrets.get("provider:deepseek-2:env:GITHUB_TOKEN")).resolves.toMatchObject({ value: "ghp_plain" })
    await expect(secrets.get("provider:deepseek-2:env:AWS_SECRET_ACCESS_KEY")).resolves.toMatchObject({ value: "secret-access-key" })
    await expect(service.buildEnv("deepseek-2")).resolves.toMatchObject({
      EXTRA_FLAG: "1",
      OPENAI_API_KEY: "sk-plain",
      GITHUB_TOKEN: "ghp_plain",
      AWS_SECRET_ACCESS_KEY: "secret-access-key",
    })
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "deepseek" })
  })
})

function makeProviderService(deps: {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly localClaudeSettingsPath?: string
  readonly readTextFile?: (filePath: string) => Promise<string>
  readonly statFile?: (filePath: string) => Promise<{ readonly size: number }>
  readonly writeTextFile?: (filePath: string, contents: string) => Promise<void>
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
    statFile: deps.statFile,
    writeTextFile: deps.writeTextFile,
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
