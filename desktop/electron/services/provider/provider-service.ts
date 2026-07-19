import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import type {
  DataNamespace,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import type {
  ActorIdentity,
  AuditSink,
  PermissionGuard,
} from "../../runtime/security"
import { ProviderSecretStore, providerApiKeySecretId, providerEnvSecretId } from "./provider-secret-store"
import type { ProviderReferenceScanResult } from "./provider-reference-scanner"
import type {
  CCProvider,
  CCProviderPreset,
  CcSwitchClaudeImportPreviewResult,
  CcSwitchImportSource,
  CreateProviderFromPresetInput,
  CreateProviderInput,
  ImportCcSwitchClaudeProvidersInput,
  ImportCcSwitchClaudeProvidersResult,
  ProviderApiKeyField,
  ProviderCategory,
  ProviderPackageExportResult,
  ProviderPackageImportInput,
  ProviderPackageImportPreview,
  ProviderPackageImportResult,
  UpdateProviderInput,
} from "./types"
import {
  getClaudeProviderPreset,
  isClaudeProviderPresetSupported,
  listClaudeProviderPresets,
  type ProviderPreset,
} from "./claude-provider-presets"
import { buildProviderInputFromClaudePreset } from "./provider-preset-adapter"
import { LOCAL_CLAUDE_CODE_PROVIDER_ID as LOCAL_PROVIDER_ID } from "./types"
import {
  buildCcSwitchClaudeImportPreview,
  buildProviderInputFromCcSwitchCandidate,
  readCcSwitchClaudeProvidersFromSourceAsync,
  resolveCcSwitchCandidateSources,
  type ReadCcSwitchSourceResult,
} from "./cc-switch-importer"
import {
  buildProviderPackage,
  createProviderInputFromPackage,
  parseProviderPackage,
  providerPackagePreview,
} from "./provider-package"

export interface ProviderServiceDeps {
  readonly providers: DataNamespace<ProviderEntryV1>
  readonly secrets: DataNamespace<SecretEntryV1>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly now?: () => Date
  readonly localClaudeSettingsPath?: string
  readonly readTextFile?: (filePath: string) => Promise<string>
  readonly statFile?: (filePath: string) => Promise<{ readonly size: number }>
  readonly writeTextFile?: (filePath: string, contents: string) => Promise<void>
  readonly ccSwitchImportSources?: () => readonly CcSwitchImportSource[]
  readonly readCcSwitchClaudeProviders?: (source: CcSwitchImportSource) => Promise<ReadCcSwitchSourceResult>
  readonly scanReferences?: (providerId: string) => Promise<ProviderReferenceScanResult>
}

export interface BuildProviderEnvContext {
  readonly actor?: ActorIdentity
  readonly projectId?: string
}

const PROVIDER_KIND = "cc-provider"
const PROVIDER_PACKAGE_MAX_BYTES = 1024 * 1024
const MAPPED_PROVIDER_ENV_KEYS = new Set([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
])

interface ProviderSecretRollbackSnapshot {
  readonly apiKey?: {
    readonly value: string | undefined
  }
  readonly env: Record<string, string | undefined>
}

export class ProviderService {
  private readonly providers: DataNamespace<ProviderEntryV1>
  private readonly secretStore: ProviderSecretStore
  private readonly permissionGuard?: PermissionGuard
  private readonly auditSink?: AuditSink
  private readonly now?: () => Date
  private readonly localClaudeSettingsPath: string
  private readonly readTextFile: (filePath: string) => Promise<string>
  private readonly statFile?: (filePath: string) => Promise<{ readonly size: number }>
  private readonly writeTextFile: (filePath: string, contents: string) => Promise<void>
  private readonly ccSwitchImportSources: () => readonly CcSwitchImportSource[]
  private readonly readCcSwitchClaudeProviders: (source: CcSwitchImportSource) => Promise<ReadCcSwitchSourceResult>
  private readonly scanReferences?: (providerId: string) => Promise<ProviderReferenceScanResult>

  constructor(deps: ProviderServiceDeps) {
    this.providers = deps.providers
    this.secretStore = new ProviderSecretStore(deps.secrets)
    this.permissionGuard = deps.permissionGuard
    this.auditSink = deps.auditSink
    this.now = deps.now
    this.localClaudeSettingsPath = deps.localClaudeSettingsPath ?? path.join(os.homedir(), ".claude", "settings.json")
    this.readTextFile = deps.readTextFile ?? ((filePath) => fs.readFile(filePath, "utf8"))
    this.statFile = deps.statFile ?? (deps.readTextFile ? undefined : fs.stat)
    this.writeTextFile = deps.writeTextFile ?? ((filePath, contents) => fs.writeFile(filePath, contents, "utf8"))
    this.ccSwitchImportSources = deps.ccSwitchImportSources ?? resolveCcSwitchCandidateSources
    this.readCcSwitchClaudeProviders = deps.readCcSwitchClaudeProviders ?? readCcSwitchClaudeProvidersFromSourceAsync
    this.scanReferences = deps.scanReferences
  }

  async listProviders(): Promise<readonly CCProvider[]> {
    const providers = (await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>))
      .map(toProvider)
      .filter((provider) => !provider.archived)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    const hasActiveUserProvider = providers.some((provider) => provider.active)
    return [
      await this.localClaudeCodeProvider(!hasActiveUserProvider),
      ...providers,
    ]
  }

  async listAllProviders(): Promise<readonly CCProvider[]> {
    const providers = (await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>))
      .map(toProvider)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    const hasActiveUserProvider = providers.some((p) => p.active && !p.archived)
    return [
      await this.localClaudeCodeProvider(!hasActiveUserProvider),
      ...providers,
    ]
  }

  async listProviderPresets(): Promise<readonly CCProviderPreset[]> {
    return listClaudeProviderPresets().map(publicPreset)
  }

  async createProviderFromPreset(input: CreateProviderFromPresetInput): Promise<CCProvider> {
    const preset = getClaudeProviderPreset(input.presetName)
    if (!preset) {
      throw new Error(`Provider preset not found: ${input.presetName}`)
    }
    if (!isClaudeProviderPresetSupported(preset)) {
      throw new Error(`Provider preset is not supported: ${input.presetName}`)
    }
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    return this.createProvider(buildProviderInputFromClaudePreset({
      preset,
      providerId: input.providerId,
      name: input.name,
      apiKey: input.apiKey,
      templateValues: input.templateValues,
      active: input.active,
      sortIndex: input.sortIndex,
      existingIds,
    }))
  }

  async previewCcSwitchClaudeProviders(
    source?: CcSwitchImportSource,
    context: BuildProviderEnvContext = {},
  ): Promise<CcSwitchClaudeImportPreviewResult> {
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    const sources = source ? [source] : this.ccSwitchImportSources()
    let lastError: unknown

    for (const candidateSource of sources) {
      try {
        await this.assertCanReadCcSwitchSource(candidateSource, context)
        const result = await this.readCcSwitchClaudeProvidersWithAudit(candidateSource, context)
        if (!source && result.providers.length === 0) continue
        return {
          source: candidateSource,
          ...buildCcSwitchClaudeImportPreview(result.providers, existingIds),
        }
      } catch (error) {
        lastError = error
        if (source) throw error
      }
    }

    return {
      items: [],
      error: lastError instanceof Error ? lastError.message : undefined,
    }
  }

  async importCcSwitchClaudeProviders(
    input: ImportCcSwitchClaudeProvidersInput,
    context: BuildProviderEnvContext = {},
  ): Promise<ImportCcSwitchClaudeProvidersResult> {
    const selectedIds = new Set(input.providerIds)
    if (selectedIds.size === 0) return { imported: [], skipped: [] }

    await this.assertCanReadCcSwitchSource(input.source, context)
    const result = await this.readCcSwitchClaudeProvidersWithAudit(input.source, context)
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    const preview = buildCcSwitchClaudeImportPreview(result.providers, existingIds)
    const previewById = new Map(preview.items.map((item) => [item.id, item]))
    const imported: CCProvider[] = []
    const skipped = [...preview.items].filter((item) => selectedIds.has(item.id) && item.status !== "ready")
    let sortIndex = this.nextUserProviderSortIndex(await this.listProviders())

    for (const provider of result.providers) {
      const previewItem = previewById.get(provider.id)
      if (!selectedIds.has(provider.id) || previewItem?.status !== "ready") continue
      imported.push(await this.createProvider(buildProviderInputFromCcSwitchCandidate(provider, sortIndex)))
      sortIndex += 1
    }

    return { imported, skipped }
  }

  async exportProviderPackage(
    providerId: string,
    targetPath: string,
    context: BuildProviderEnvContext = {},
  ): Promise<ProviderPackageExportResult> {
    if (providerId === LOCAL_PROVIDER_ID) {
      throw new Error("不支持导出内置供应商")
    }
    await this.assertCanWriteProviderPackage(targetPath, providerId, context)
    const provider = await this.getProvider(providerId)
    const apiKey = provider.secretRef
      ? await this.readSecretValue(provider, context)
      : undefined
    if (!apiKey) {
      throw new Error("供应商密钥读取失败")
    }
    const secretEnv = await this.readSecretEnvValues(provider, context)
    const pkg = buildProviderPackage({
      exportedAt: this.isoNow(),
      provider,
      apiKey,
      secretEnv,
    })

    try {
      await this.writeTextFile(targetPath, `${JSON.stringify(pkg, null, 2)}\n`)
      this.recordProviderPackageFileAudit("fs.write.outside-userdata", targetPath, providerId, "allowed", context)
      return { filePath: targetPath }
    } catch (error) {
      this.recordProviderPackageFileAudit("fs.write.outside-userdata", targetPath, providerId, "failed", context, error)
      throw error
    }
  }

  async previewProviderPackageImport(
    sourcePath: string,
    context: BuildProviderEnvContext = {},
  ): Promise<ProviderPackageImportPreview> {
    await this.assertCanReadProviderPackage(sourcePath, context)
    const { pkg, contentSha256 } = await this.readProviderPackage(sourcePath, context)
    const existingIds = new Set((await this.listProviders()).map((provider) => provider.id))
    return providerPackagePreview(pkg, sourcePath, existingIds, contentSha256)
  }

  async importProviderPackage(
    sourcePath: string,
    input: ProviderPackageImportInput = {},
    context: BuildProviderEnvContext = {},
  ): Promise<ProviderPackageImportResult> {
    await this.assertCanReadProviderPackage(sourcePath, context)
    const { pkg, contentSha256 } = await this.readProviderPackage(sourcePath, context, input.contentSha256)
    const providers = await this.listProviders()
    const existingIds = new Set(providers.map((provider) => provider.id))
    const preview = providerPackagePreview(pkg, sourcePath, existingIds, contentSha256)
    const sortIndex = this.nextUserProviderSortIndex(providers)
    const provider = await this.createProvider(createProviderInputFromPackage(pkg, preview.targetProviderId, sortIndex))
    return { provider }
  }

  async createProvider(input: CreateProviderInput): Promise<CCProvider> {
    if (input.id === LOCAL_PROVIDER_ID) {
      throw new Error("The ClaudeCode/Synapse provider is built in and cannot be created.")
    }
    const hasSecretWrite = input.apiKey !== undefined
      || (input.secretEnv !== undefined && Object.keys(input.secretEnv).length > 0)
    if (hasSecretWrite) {
      await this.assertSecretWrite(input.id, "create")
    }
    const now = this.isoNow()
    let secretRef: string | undefined
    let secretEnvRefs: Record<string, string> | undefined
    try {
      secretRef = input.apiKey === undefined
        ? undefined
        : await this.secretStore.setApiKey(input.id, input.apiKey, `${input.name} API key`)
      secretEnvRefs = await storeSecretEnv(
        this.secretStore,
        input.id,
        input.name,
        input.secretEnv,
      )
    } catch (error) {
      this.recordSecretWriteAudit(input.id, "create", "failed", errorAuditMetadata(error))
      throw error
    }
    const provider = toProviderEntry({
      id: input.id,
      name: input.name,
      note: input.note,
      websiteUrl: input.websiteUrl,
      category: input.category,
      baseUrl: input.baseUrl,
      apiKeyField: input.apiKeyField,
      active: input.active,
      model: input.model,
      haikuModel: input.haikuModel,
      sonnetModel: input.sonnetModel,
      opusModel: input.opusModel,
      env: input.env ?? {},
      settingsConfig: input.settingsConfig,
      secretRef,
      secretEnvRefs,
      sortIndex: input.sortIndex,
      createdAt: now,
      updatedAt: now,
    })
    try {
      await this.providers.upsert(provider)
      if (input.active) {
        await this.setActiveProvider(input.id)
        const active = await this.getProvider(input.id)
        if (hasSecretWrite) {
          this.recordSecretWriteAudit(input.id, "create", "allowed", { secretRef, secretEnvRefs })
        }
        return active
      }
    } catch (error) {
      try {
        await this.rollbackCreatedProvider(input.id, secretRef, secretEnvRefs)
      } catch (rollbackError) {
        if (hasSecretWrite) {
          this.recordSecretWriteAudit(input.id, "create", "failed", {
            ...errorAuditMetadata(error),
            rollbackErrorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
            rollbackErrorLength: String(rollbackError).length,
          })
        }
        throw rollbackError
      }
      if (hasSecretWrite) {
        this.recordSecretWriteAudit(input.id, "create", "failed", errorAuditMetadata(error))
      }
      throw error
    }
    if (hasSecretWrite) {
      this.recordSecretWriteAudit(input.id, "create", "allowed", { secretRef, secretEnvRefs })
    }
    return toProvider(provider)
  }

  async updateProvider(id: string, patch: UpdateProviderInput): Promise<CCProvider> {
    if (id === LOCAL_PROVIDER_ID) {
      throw new Error("The ClaudeCode/Synapse provider cannot be edited.")
    }
    const existing = await this.getProvider(id)
    const nextActive = patch.active ?? existing.active
    const nextArchived = patch.archived ?? existing.archived
    if (nextActive && nextArchived) {
      throw new Error(`Provider cannot be active and archived: ${id}`)
    }
    const hasSecretChange = patch.apiKey !== undefined
      || (patch.clearSecretEnv && patch.clearSecretEnv.length > 0)
      || (patch.secretEnv && Object.keys(patch.secretEnv).length > 0)
    if (hasSecretChange) {
      await this.assertSecretWrite(id, "update")
    }
    let secretRef: string | undefined
    let nextSecretEnvRefs: Record<string, string | undefined>
    let secretRollbackSnapshot: ProviderSecretRollbackSnapshot | undefined
    try {
      secretRollbackSnapshot = hasSecretChange
        ? await this.captureProviderSecretRollbackSnapshot(existing, patch)
        : undefined
      secretRef = patch.apiKey === undefined
        ? existing.secretRef
        : await this.secretStore.setApiKey(id, patch.apiKey, `${patch.name ?? existing.name} API key`)
      nextSecretEnvRefs = { ...(existing.secretEnvRefs ?? {}) }
      for (const envName of patch.clearSecretEnv ?? []) {
        const ref = nextSecretEnvRefs[envName]
        if (ref) {
          await this.secretStore.deleteSecret(ref)
        }
        delete nextSecretEnvRefs[envName]
      }
      const storedSecretEnvRefs = await storeSecretEnv(
        this.secretStore,
        id,
        patch.name ?? existing.name,
        patch.secretEnv,
      )
      Object.assign(nextSecretEnvRefs, storedSecretEnvRefs)
    } catch (error) {
      if (hasSecretChange) {
        this.recordSecretWriteAudit(id, "update", "failed", errorAuditMetadata(error))
      }
      throw error
    }
    const updated: CCProvider = {
      ...existing,
      ...providerPatch(patch),
      secretRef,
      secretEnvRefs: Object.keys(nextSecretEnvRefs).length ? nextSecretEnvRefs as Record<string, string> : undefined,
      updatedAt: this.isoNow(),
    }
    try {
      await this.providers.upsert(toProviderEntry(updated))
    } catch (error) {
      if (secretRollbackSnapshot) {
        try {
          await this.restoreProviderSecrets(id, existing.name, secretRollbackSnapshot)
        } catch (rollbackError) {
          this.recordSecretWriteAudit(id, "update", "failed", {
            ...errorAuditMetadata(error),
            rollbackErrorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
            rollbackErrorLength: String(rollbackError).length,
          })
          throw rollbackError
        }
      }
      if (hasSecretChange) {
        this.recordSecretWriteAudit(id, "update", "failed", errorAuditMetadata(error))
      }
      throw error
    }
    if (hasSecretChange) {
      this.recordSecretWriteAudit(id, "update", "allowed", {
        secretRef,
        secretEnvRefs: Object.keys(nextSecretEnvRefs).length ? nextSecretEnvRefs : undefined,
      })
    }
    if (patch.active) {
      await this.setActiveProvider(id)
      return this.getProvider(id)
    }
    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    if (id === LOCAL_PROVIDER_ID) {
      throw new Error("The ClaudeCode/Synapse provider cannot be deleted.")
    }
    if (this.scanReferences) {
      const result = await this.scanReferences(id)
      if (result.references.length > 0) {
        const byKind = {
          workflow: result.references.filter((r) => r.kind === "workflow-node").map((r) => r.entityName),
          conversation: result.references.filter((r) => r.kind === "conversation").map((r) => r.entityName),
          agentPersona: result.references.filter((r) => r.kind === "agent-persona").map((r) => r.entityName),
        }
        const parts: string[] = []
        if (byKind.workflow.length) parts.push(`${byKind.workflow.length} 个工作流（${byKind.workflow.join("、")}）`)
        if (byKind.conversation.length) parts.push(`${byKind.conversation.length} 个会话（${byKind.conversation.join("、")}）`)
        if (byKind.agentPersona.length) parts.push(`${byKind.agentPersona.length} 个智能体（${byKind.agentPersona.join("、")}）`)
        throw new Error(`无法删除：该供应商正在被 ${parts.join("、")} 使用，请先处理引用后再删除。`)
      }
    }
    await this.assertSecretWrite(id, "delete")
    const provider = await this.getProvider(id)

    try {
      if (provider.secretRef) {
        await this.secretStore.deleteSecret(provider.secretRef)
      }
      if (provider.secretEnvRefs) {
        for (const secretRef of Object.values(provider.secretEnvRefs)) {
          await this.secretStore.deleteSecret(secretRef)
        }
      }
    } catch (error) {
      this.recordSecretWriteAudit(id, "delete", "failed", errorAuditMetadata(error))
      throw error
    }
    await this.providers.remove(id)
    this.recordSecretWriteAudit(id, "delete", "allowed", {
      secretRef: provider.secretRef,
      secretEnvRefs: provider.secretEnvRefs,
    })
  }

  async archiveProvider(id: string): Promise<void> {
    if (id === LOCAL_PROVIDER_ID) {
      throw new Error("The ClaudeCode/Synapse provider cannot be archived.")
    }
    await this.updateProvider(id, { active: false, archived: true })
  }

  async setActiveProvider(id: string): Promise<void> {
    if (id === LOCAL_PROVIDER_ID) {
      await this.clearActiveUserProvider()
      return
    }
    const target = await this.getProvider(id)
    if (target.archived) {
      throw new Error(`Cannot set archived provider active: ${id}`)
    }
    const now = this.isoNow()
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    await this.applyProviderActiveState(providers, target.id, now)
  }

  async getActiveProvider(): Promise<CCProvider | null> {
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    const active = providers.map(toProvider).find((provider) => provider.active && !provider.archived)
    return active ?? this.localClaudeCodeProvider(true)
  }

  async getProvider(id: string): Promise<CCProvider> {
    if (id === LOCAL_PROVIDER_ID) {
      const active = await this.getActiveProvider()
      return this.localClaudeCodeProvider(active?.id === LOCAL_PROVIDER_ID)
    }
    const provider = await this.providers.get(id)
    if (!provider || provider.kind !== PROVIDER_KIND) {
      throw new Error(`Provider not found: ${id}`)
    }
    return toProvider(provider)
  }

  async buildEnv(
    providerId: string,
    context: BuildProviderEnvContext = {},
  ): Promise<Record<string, string>> {
    if (providerId === LOCAL_PROVIDER_ID) {
      return {}
    }
    const provider = await this.getProvider(providerId)
    const secret = provider.secretRef
      ? await this.readSecretValue(provider, context)
      : undefined
    const secretEnv = await this.readSecretEnvValues(provider, context)
    const env: Record<string, string | undefined> = {}

    if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl
    if (provider.apiKeyField === "ANTHROPIC_AUTH_TOKEN") {
      env.ANTHROPIC_AUTH_TOKEN = secret
      env.ANTHROPIC_API_KEY = ""
    } else {
      env.ANTHROPIC_AUTH_TOKEN = ""
      env.ANTHROPIC_API_KEY = secret
    }
    if (provider.model) env.ANTHROPIC_MODEL = provider.model
    if (provider.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.haikuModel
    if (provider.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.sonnetModel
    if (provider.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.opusModel

    return compactEnv({
      ...env,
      ...extraProviderEnv(provider.env),
      ...extraProviderEnv(secretEnv),
    })
  }

  async buildEnvSafe(
    providerId: string,
    context: BuildProviderEnvContext = {},
  ): Promise<
    | { ok: true; env: Record<string, string> }
    | { ok: false; reason: "not_found" | "secret_error"; message: string }
  > {
    try {
      const env = await this.buildEnv(providerId, context)
      return { ok: true, env }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("not found")) {
        return { ok: false, reason: "not_found", message: "供应商已删除或不可用" }
      }
      return { ok: false, reason: "secret_error", message: "供应商密钥读取失败" }
    }
  }

  private async readSecretValue(
    provider: CCProvider,
    context: BuildProviderEnvContext,
  ): Promise<string | undefined> {
    const secretRef = provider.secretRef
    if (!secretRef) return undefined
    return this.readSecretRef(provider, secretRef, context)
  }

  private async readSecretEnvValues(
    provider: CCProvider,
    context: BuildProviderEnvContext,
  ): Promise<Record<string, string>> {
    const refs = provider.secretEnvRefs ?? {}
    const result: Record<string, string> = {}
    for (const [envName, secretRef] of Object.entries(refs)) {
      const value = await this.readSecretRef(provider, secretRef, context)
      if (value !== undefined) result[envName] = value
    }
    return result
  }

  private async readSecretRef(
    provider: CCProvider,
    secretRef: string,
    context: BuildProviderEnvContext,
  ): Promise<string | undefined> {
    const actor = context.actor ?? { kind: "user" }
    const metadata = removeUndefined({
      providerId: provider.id,
      projectId: context.projectId,
    })

    if (this.permissionGuard) {
      const permission = await this.permissionGuard.check({
        action: "secret.read",
        actor,
        resource: secretRef,
        context: metadata,
      })
      if (!permission.allowed) {
        this.auditSink?.record({
          action: "secret.read",
          actor,
          resource: secretRef,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error(permission.reason)
      }
    }

    try {
      const value = await this.secretStore.getSecretValue(secretRef)
      this.auditSink?.record({
        action: "secret.read",
        actor,
        resource: secretRef,
        outcome: "allowed",
        metadata,
      })
      return value
    } catch (error) {
      this.auditSink?.record({
        action: "secret.read",
        actor,
        resource: secretRef,
        outcome: "failed",
        metadata: {
          ...metadata,
          ...errorAuditMetadata(error),
        },
      })
      throw error
    }
  }

  private async captureProviderSecretRollbackSnapshot(
    provider: CCProvider,
    patch: UpdateProviderInput,
  ): Promise<ProviderSecretRollbackSnapshot> {
    const envNames = new Set([
      ...(patch.clearSecretEnv ?? []),
      ...Object.keys(patch.secretEnv ?? {}),
    ])
    const env: Record<string, string | undefined> = {}
    for (const envName of envNames) {
      const ref = provider.secretEnvRefs?.[envName] ?? providerEnvSecretId(provider.id, envName)
      env[envName] = await this.secretStore.getSecretValue(ref)
    }

    return {
      apiKey: patch.apiKey === undefined
        ? undefined
        : { value: await this.secretStore.getSecretValue(provider.secretRef ?? providerApiKeySecretId(provider.id)) },
      env,
    }
  }

  private async restoreProviderSecrets(
    providerId: string,
    providerName: string,
    snapshot: ProviderSecretRollbackSnapshot,
  ): Promise<void> {
    if (snapshot.apiKey) {
      if (snapshot.apiKey.value === undefined) {
        await this.secretStore.deleteSecret(providerApiKeySecretId(providerId))
      } else {
        await this.secretStore.setApiKey(providerId, snapshot.apiKey.value, `${providerName} API key`)
      }
    }
    for (const [envName, value] of Object.entries(snapshot.env)) {
      if (value === undefined) {
        await this.secretStore.deleteSecret(providerEnvSecretId(providerId, envName))
      } else {
        await this.secretStore.setEnvSecret(providerId, envName, value, `${providerName} ${envName}`)
      }
    }
  }

  private async rollbackCreatedProvider(
    providerId: string,
    secretRef: string | undefined,
    secretEnvRefs: Record<string, string> | undefined,
  ): Promise<void> {
    await this.providers.remove(providerId)
    if (secretRef) {
      await this.secretStore.deleteSecret(secretRef)
    }
    for (const ref of Object.values(secretEnvRefs ?? {})) {
      await this.secretStore.deleteSecret(ref)
    }
  }

  private isoNow(): string {
    return (this.now?.() ?? new Date()).toISOString()
  }

  private async assertSecretWrite(
    providerId: string,
    operation: "create" | "update" | "delete",
  ): Promise<void> {
    const actor: ActorIdentity = { kind: "user" }
    const resource = `provider:${providerId}`
    const metadata = { providerId, operation }

    if (this.permissionGuard) {
      const permission = await this.permissionGuard.check({
        action: "secret.write",
        actor,
        resource,
        context: metadata,
      })
      if (!permission.allowed) {
        this.auditSink?.record({
          action: "secret.write",
          actor,
          resource,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error(permission.reason)
      }
    }
  }

  private recordSecretWriteAudit(
    providerId: string,
    operation: "create" | "update" | "delete",
    outcome: "allowed" | "failed",
    extra?: Record<string, unknown>,
  ): void {
    this.auditSink?.record({
      action: "secret.write",
      actor: { kind: "user" },
      resource: `provider:${providerId}`,
      outcome,
      metadata: removeUndefined({ providerId, operation, ...extra } as Record<string, unknown>),
    })
  }

  private async readCcSwitchClaudeProvidersWithAudit(
    source: CcSwitchImportSource,
    context: BuildProviderEnvContext,
  ): ReturnType<ProviderService["readCcSwitchClaudeProviders"]> {
    try {
      return await this.readCcSwitchClaudeProviders(source)
    } catch (error) {
      this.recordCcSwitchReadFailed(source, context, error)
      throw error
    }
  }

  private async assertCanReadCcSwitchSource(
    source: CcSwitchImportSource,
    context: BuildProviderEnvContext,
  ): Promise<void> {
    const actor = context.actor ?? { kind: "user" }
    const metadata = removeUndefined({
      projectId: context.projectId,
      sourceKind: source.kind,
    })

    if (this.permissionGuard) {
      const permission = await this.permissionGuard.check({
        action: "fs.read.outside-userdata",
        actor,
        resource: source.path,
        context: metadata,
      })
      if (!permission.allowed) {
        this.auditSink?.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: source.path,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error(permission.reason)
      }
    }

    this.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor,
      resource: source.path,
      outcome: "allowed",
      metadata,
    })
  }

  private recordCcSwitchReadFailed(
    source: CcSwitchImportSource,
    context: BuildProviderEnvContext,
    error: unknown,
  ): void {
    this.auditSink?.record({
      action: "fs.read.outside-userdata",
      actor: context.actor ?? { kind: "user" },
      resource: source.path,
      outcome: "failed",
      metadata: removeUndefined({
        projectId: context.projectId,
        sourceKind: source.kind,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      }),
    })
  }

  private async readProviderPackage(
    sourcePath: string,
    context: BuildProviderEnvContext,
    expectedContentSha256?: string,
  ) {
    try {
      await this.assertProviderPackageSize(sourcePath)
      const text = await this.readTextFile(sourcePath)
      if (Buffer.byteLength(text, "utf8") > PROVIDER_PACKAGE_MAX_BYTES) {
        throw new Error("Provider 包文件过大。")
      }
      const contentSha256 = createHash("sha256").update(text, "utf8").digest("hex")
      if (expectedContentSha256 && contentSha256 !== expectedContentSha256) {
        throw new Error("Provider 包已变更，请重新预览后再导入。")
      }
      return { pkg: parseProviderPackage(JSON.parse(text)), contentSha256 }
    } catch (error) {
      this.recordProviderPackageFileAudit("fs.read.outside-userdata", sourcePath, undefined, "failed", context, error)
      if (error instanceof SyntaxError) {
        throw new Error("无法识别该文件")
      }
      throw error
    }
  }

  private async assertProviderPackageSize(sourcePath: string): Promise<void> {
    const fileStat = await this.statFile?.(sourcePath)
    if (fileStat && fileStat.size > PROVIDER_PACKAGE_MAX_BYTES) {
      throw new Error("Provider 包文件过大。")
    }
  }

  private async assertCanReadProviderPackage(sourcePath: string, context: BuildProviderEnvContext): Promise<void> {
    const actor = context.actor ?? { kind: "user" }
    const metadata = removeUndefined({
      projectId: context.projectId,
      packageKind: "synapse.provider.package",
    })

    if (this.permissionGuard) {
      const permission = await this.permissionGuard.check({
        action: "fs.read.outside-userdata",
        actor,
        resource: sourcePath,
        context: metadata,
      })
      if (!permission.allowed) {
        this.auditSink?.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: sourcePath,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error(permission.reason)
      }
    }

    this.recordProviderPackageFileAudit("fs.read.outside-userdata", sourcePath, undefined, "allowed", context)
  }

  private async assertCanWriteProviderPackage(
    targetPath: string,
    providerId: string,
    context: BuildProviderEnvContext,
  ): Promise<void> {
    const actor = context.actor ?? { kind: "user" }
    const metadata = removeUndefined({
      projectId: context.projectId,
      providerId,
      packageKind: "synapse.provider.package",
    })

    if (this.permissionGuard) {
      const permission = await this.permissionGuard.check({
        action: "fs.write.outside-userdata",
        actor,
        resource: targetPath,
        context: metadata,
      })
      if (!permission.allowed) {
        this.auditSink?.record({
          action: "fs.write.outside-userdata",
          actor,
          resource: targetPath,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: permission.reason,
            policyId: permission.policyId,
          },
        })
        throw new Error(permission.reason)
      }
    }
  }

  private recordProviderPackageFileAudit(
    action: "fs.read.outside-userdata" | "fs.write.outside-userdata",
    resource: string,
    providerId: string | undefined,
    outcome: "allowed" | "failed",
    context: BuildProviderEnvContext,
    error?: unknown,
  ): void {
    this.auditSink?.record({
      action,
      actor: context.actor ?? { kind: "user" },
      resource,
      outcome,
      metadata: removeUndefined({
        projectId: context.projectId,
        providerId,
        packageKind: "synapse.provider.package",
        version: 1,
        ...(error ? errorAuditMetadata(error) : {}),
      }),
    })
  }

  private nextUserProviderSortIndex(providers: readonly CCProvider[]): number {
    const sortIndexes = providers
      .filter((provider) => provider.id !== LOCAL_PROVIDER_ID)
      .map((provider) => provider.sortIndex ?? 0)
    return sortIndexes.length === 0 ? 0 : Math.max(...sortIndexes) + 1
  }

  private async clearActiveUserProvider(): Promise<void> {
    const now = this.isoNow()
    const providers = await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>)
    await this.applyProviderActiveState(providers.filter((provider) => toProvider(provider).active), null, now)
  }

  private async applyProviderActiveState(
    providers: readonly ProviderEntryV1[],
    activeProviderId: string | null,
    now: string,
  ): Promise<void> {
    const snapshot = providers.map((provider) => ({ ...provider }))
    try {
      for (const provider of providers) {
        const current = toProvider(provider)
        await this.providers.upsert(toProviderEntry({
          ...current,
          active: current.id === activeProviderId,
          updatedAt: now,
        }))
      }
    } catch (error) {
      await this.restoreProviderEntries(snapshot)
      throw error
    }
  }

  private async restoreProviderEntries(providers: readonly ProviderEntryV1[]): Promise<void> {
    for (const provider of providers) {
      await this.providers.upsert(provider)
    }
  }

  private async localClaudeCodeProvider(active: boolean): Promise<CCProvider> {
    const settings = await this.readLocalClaudeSettings()
    const env = settings.env
    return {
      id: LOCAL_PROVIDER_ID,
      name: "ClaudeCode/Synapse",
      category: "official",
      source: "local",
      readonly: true,
      configured: true,
      configPath: this.localClaudeSettingsPath,
      websiteUrl: "https://www.anthropic.com/claude-code",
      baseUrl: env.ANTHROPIC_BASE_URL,
      apiKeyField: env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN",
      active,
      model: env.ANTHROPIC_MODEL ?? settings.model,
      haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env: {},
      settingsConfig: {},
      sortIndex: -10000,
      createdAt: "",
      updatedAt: "",
    }
  }

  private async readLocalClaudeSettings(): Promise<{
    readonly env: Record<string, string>
    readonly model?: string
  }> {
    try {
      const raw = await this.readTextFile(this.localClaudeSettingsPath)
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) return { env: {} }
      const envRaw = isRecord(parsed.env) ? parsed.env : {}
      const env = pickStringEnv(envRaw, [
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
      ])
      return {
        env,
        model: stringValue(parsed.model),
      }
    } catch {
      return { env: {} }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pickStringEnv(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) {
      env[key] = value
    }
  }
  return env
}

function toProviderEntry(provider: CCProvider): ProviderEntryV1 {
  return removeUndefined({
    id: provider.id,
    schemaVersion: 1,
    scope: "global",
    kind: PROVIDER_KIND,
    display: provider.name,
    note: provider.note,
    websiteUrl: provider.websiteUrl,
    baseUrl: provider.baseUrl,
    secretRef: provider.secretRef ?? providerApiKeySecretId(provider.id),
    secretEnvRefs: provider.secretEnvRefs,
    activeModel: provider.model,
    env: provider.env,
    settingsConfig: provider.settingsConfig,
    category: provider.category,
    apiKeyField: provider.apiKeyField,
    active: provider.active,
    haikuModel: provider.haikuModel,
    sonnetModel: provider.sonnetModel,
    opusModel: provider.opusModel,
    archived: provider.archived,
    sortIndex: provider.sortIndex,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }) as ProviderEntryV1
}

function toProvider(entry: ProviderEntryV1): CCProvider {
  return {
    id: entry.id,
    name: typeof entry.display === "string" ? entry.display : entry.id,
    note: stringValue(entry.note),
    websiteUrl: stringValue(entry.websiteUrl),
    category: providerCategory(entry.category),
    baseUrl: entry.baseUrl,
    apiKeyField: apiKeyField(entry.apiKeyField),
    active: booleanValue(entry.active),
    model: entry.activeModel,
    haikuModel: stringValue(entry.haikuModel),
    sonnetModel: stringValue(entry.sonnetModel),
    opusModel: stringValue(entry.opusModel),
    env: entry.env ?? {},
    settingsConfig: isRecord(entry.settingsConfig) ? entry.settingsConfig : undefined,
    secretRef: entry.secretRef,
    secretEnvRefs: entry.secretEnvRefs,
    archived: booleanValue(entry.archived),
    sortIndex: numberValue(entry.sortIndex),
    createdAt: entry.createdAt ?? "",
    updatedAt: entry.updatedAt ?? "",
  }
}

function publicPreset(preset: ProviderPreset): CCProviderPreset {
  const env = isRecord(preset.settingsConfig) && isRecord(preset.settingsConfig.env)
    ? preset.settingsConfig.env
    : {}
  return {
    name: preset.name,
    category: preset.category ?? "custom",
    websiteUrl: preset.websiteUrl,
    apiKeyUrl: preset.apiKeyUrl,
    baseUrl: stringValue(env.ANTHROPIC_BASE_URL),
    apiKeyField: preset.apiKeyField ?? (typeof env.ANTHROPIC_API_KEY === "string" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"),
    model: stringValue(env.ANTHROPIC_MODEL),
    haikuModel: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnetModel: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opusModel: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
    templateValues: Object.entries(preset.templateValues ?? {}).map(([key, value]) => ({
      key,
      label: value.label,
      placeholder: value.placeholder,
      defaultValue: value.defaultValue ?? value.editorValue,
      sensitive: isSensitiveTemplateKey(key),
    })),
  }
}

function isSensitiveTemplateKey(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(key)
}

function compactEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
}

function extraProviderEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !MAPPED_PROVIDER_ENV_KEYS.has(key)),
  )
}

async function storeSecretEnv(
  secretStore: ProviderSecretStore,
  providerId: string,
  providerName: string,
  input?: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  if (!input || Object.keys(input).length === 0) return undefined
  const refs: Record<string, string> = {}
  for (const [envName, value] of Object.entries(input)) {
    refs[envName] = await secretStore.setEnvSecret(
      providerId,
      envName,
      value,
      `${providerName} ${envName}`,
    )
  }
  return refs
}

function providerPatch(input: UpdateProviderInput): Partial<CCProvider> {
  return removeUndefined({
    name: input.name,
    note: input.note,
    websiteUrl: input.websiteUrl,
    category: input.category,
    baseUrl: input.baseUrl,
    apiKeyField: input.apiKeyField,
    active: input.active,
    model: input.model,
    haikuModel: input.haikuModel,
    sonnetModel: input.sonnetModel,
    opusModel: input.opusModel,
    env: input.env,
    settingsConfig: input.settingsConfig,
    archived: input.archived,
    sortIndex: input.sortIndex,
  })
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T
}

function providerCategory(value: unknown): ProviderCategory {
  if (
    value === "official"
    || value === "cn_official"
    || value === "cloud_provider"
    || value === "aggregator"
    || value === "third_party"
    || value === "custom"
  ) {
    return value
  }
  return "custom"
}

function apiKeyField(value: unknown): ProviderApiKeyField {
  return value === "ANTHROPIC_API_KEY" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN"
}

function errorAuditMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const text = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: text.length,
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}
