import type {
  DataNamespace,
  ProviderEntryV1,
  ProviderModelEntryV1,
  ProviderOptionsV1,
  SecretEntryV1,
} from "../../runtime/data-repo"
import type {
  ActorIdentity,
  AuditSink,
  PermissionGuard,
} from "../../runtime/security"
import type {
  AgentRuntimeAgentType,
  ProjectProviderState,
  ProviderConfigInput,
  ProviderConfigView,
  ProviderRuntimeRequest,
  ProviderRuntimeView,
} from "./types"
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"

export interface ProviderConfigServiceDeps {
  readonly providers: DataNamespace<ProviderEntryV1>
  readonly secrets: DataNamespace<SecretEntryV1>
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly now?: () => Date
}

const PROJECT_STATE_KIND = "state"
const DEFAULT_PROVIDER_KIND = "openai-compatible"

export class ProviderConfigService {
  private readonly deps: ProviderConfigServiceDeps

  constructor(deps: ProviderConfigServiceDeps) {
    this.deps = deps
  }

  async listGlobalProviders(): Promise<readonly ProviderConfigView[]> {
    const providers = await this.deps.providers.list({ scope: "global" } as Partial<ProviderEntryV1>)
    return providers
      .filter((provider) => provider.kind !== PROJECT_STATE_KIND)
      .map((provider) => toProviderView(provider))
  }

  async upsertGlobalProvider(input: ProviderConfigInput): Promise<ProviderConfigView> {
    const existing = await this.deps.providers.get(input.id)
    const entry = providerEntryFromInput(input, {
      existing: existing ?? undefined,
      scope: "global",
      now: this.isoNow(),
    })
    await this.deps.providers.upsert(entry)
    return toProviderView(entry)
  }

  async upsertProjectProvider(
    projectId: string,
    input: ProviderConfigInput,
  ): Promise<ProviderConfigView> {
    const id = projectProviderEntryId(projectId, input.id)
    const existing = await this.deps.providers.get(id)
    const entry = providerEntryFromInput(input, {
      existing: existing ?? undefined,
      id,
      providerId: input.id,
      scope: "project",
      projectId,
      now: this.isoNow(),
    })
    await this.deps.providers.upsert(entry)
    return toProviderView(entry)
  }

  async removeGlobalProvider(providerId: string): Promise<void> {
    await this.deps.providers.remove(providerId)
  }

  async getProjectProviderState(
    projectId: string,
    agentType: AgentRuntimeAgentType,
  ): Promise<ProjectProviderState> {
    const state = await this.getProjectStateEntry(projectId)
    const inline = await this.listProjectInlineProviders(projectId)
    const inlineProviderIds = new Set(inline.map(providerConfigId))
    const globalProviders = await this.deps.providers.list({ scope: "global" } as Partial<ProviderEntryV1>)
    const globalById = new Map(globalProviders.map((provider) => [provider.id, provider]))
    const providers: ProviderConfigView[] = []

    for (const ref of state?.providerRefs ?? []) {
      if (inlineProviderIds.has(ref)) continue
      const provider = globalById.get(ref)
      if (!provider || !matchesAgentType(provider, agentType)) continue
      providers.push(toProviderView(provider, agentType))
    }

    for (const provider of inline) {
      if (!matchesAgentType(provider, agentType)) continue
      providers.push(toProviderView(provider, agentType))
    }

    const activeProvider = providers.find((provider) => provider.id === state?.activeProviderId)
    const activeModel = activeProvider?.model ?? state?.activeModel

    return {
      projectId,
      agentType,
      providers,
      activeProvider,
      activeProviderId: state?.activeProviderId,
      activeModel,
      activeMode: state?.activeMode,
    }
  }

  async setProjectProviderRefs(projectId: string, refs: readonly string[]): Promise<ProjectProviderState> {
    const state = await this.upsertProjectState(projectId, { providerRefs: [...refs] })
    return this.getProjectProviderState(projectId, state.agentType ?? "codex")
  }

  async setActiveProvider(projectId: string, providerId: string | null): Promise<ProjectProviderState> {
    const state = await this.upsertProjectState(projectId, {
      activeProviderId: providerId ?? undefined,
    })
    return this.getProjectProviderState(projectId, state.agentType ?? "codex")
  }

  async setActiveModel(
    projectId: string,
    model: string,
    agentType: AgentRuntimeAgentType = "codex",
  ): Promise<ProjectProviderState> {
    const state = await this.getOrCreateProjectStateEntry(projectId)
    if (state.activeProviderId) {
      const provider = await this.findProviderEntry(projectId, state.activeProviderId)
      if (provider) {
        await this.deps.providers.upsert(setProviderModel(provider, model, agentType, this.isoNow()))
        return this.getProjectProviderState(projectId, agentType)
      }
    }
    await this.upsertProjectState(projectId, { activeModel: model, agentType })
    return this.getProjectProviderState(projectId, agentType)
  }

  async setActiveMode(
    projectId: string,
    mode: string,
    agentType: AgentRuntimeAgentType = "codex",
  ): Promise<ProjectProviderState> {
    await this.upsertProjectState(projectId, { activeMode: mode, agentType })
    return this.getProjectProviderState(projectId, agentType)
  }

  async getActiveAgentType(
    projectId: string,
    fallback: AgentRuntimeAgentType = "codex",
  ): Promise<AgentRuntimeAgentType> {
    const state = await this.getProjectStateEntry(projectId)
    if (state?.agentType) return normalizeAgentType(state.agentType)

    const activeProviderId = state?.activeProviderId
    if (activeProviderId) {
      const provider = await this.findProviderEntry(projectId, activeProviderId)
      const agentTypes = providerAgentTypes(provider)
      if (agentTypes.length === 1 && agentTypes[0]) {
        return normalizeAgentType(agentTypes[0])
      }
    }

    return normalizeAgentType(fallback)
  }

  async resolveRuntimeConfig(
    projectId: string,
    agentType: AgentRuntimeAgentType,
    request: ProviderRuntimeRequest = {},
  ): Promise<ProviderRuntimeView> {
    const definition = agentRuntimeDefinitionById.get(normalizeAgentType(agentType))
    if (!definition) {
      throw new Error(`Unknown agent runtime: ${agentType}`)
    }
    const state = await this.getProjectProviderState(projectId, agentType)
    const provider = state.activeProvider
    const apiKey = provider?.secretRef
      ? await this.readSecretValue(provider.secretRef, request.actor ?? { kind: "user" }, {
        projectId,
        providerId: provider.id,
        agentType,
      })
      : undefined
    const model = provider?.model ?? state.activeModel
    const mode = state.activeMode
    const envResult = definition.buildEnv({ provider, apiKey, model })
    const env = envResult.env

    return {
      ...state,
      provider,
      model,
      mode,
      baseUrl: provider?.baseUrl,
      apiKey,
      env,
      envAllowlist: [
        ...Object.keys(env).filter((key) => env[key] !== undefined),
        ...(envResult.extraEnvAllowlist ?? []),
      ],
    }
  }

  private async getProjectStateEntry(projectId: string): Promise<ProviderEntryV1 | null> {
    return this.deps.providers.get(projectStateEntryId(projectId))
  }

  private async getOrCreateProjectStateEntry(projectId: string): Promise<ProviderEntryV1> {
    const existing = await this.getProjectStateEntry(projectId)
    if (existing) return existing
    const now = this.isoNow()
    const entry: ProviderEntryV1 = {
      id: projectStateEntryId(projectId),
      schemaVersion: 1,
      scope: "project",
      kind: PROJECT_STATE_KIND,
      projectId,
      providerRefs: [],
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.providers.upsert(entry)
    return entry
  }

  private async upsertProjectState(
    projectId: string,
    patch: Partial<ProviderEntryV1>,
  ): Promise<ProviderEntryV1> {
    const existing = await this.getOrCreateProjectStateEntry(projectId)
    const updated: ProviderEntryV1 = {
      ...existing,
      ...patch,
      id: existing.id,
      schemaVersion: 1,
      scope: "project",
      kind: PROJECT_STATE_KIND,
      projectId,
      updatedAt: this.isoNow(),
    }
    await this.deps.providers.upsert(updated)
    return updated
  }

  private async listProjectInlineProviders(projectId: string): Promise<ProviderEntryV1[]> {
    const providers = await this.deps.providers.list({
      scope: "project",
      projectId,
    } as Partial<ProviderEntryV1>)
    return providers.filter((provider) => provider.kind !== PROJECT_STATE_KIND)
  }

  private async findProviderEntry(
    projectId: string,
    providerId: string,
  ): Promise<ProviderEntryV1 | null> {
    const inline = await this.deps.providers.get(projectProviderEntryId(projectId, providerId))
    if (inline) return inline
    return this.deps.providers.get(providerId)
  }

  private async readSecretValue(
    secretRef: string,
    actor: ActorIdentity,
    context: Record<string, unknown>,
  ): Promise<string | undefined> {
    if (this.deps.permissionGuard) {
      const permission = await this.deps.permissionGuard.check({
        action: "secret.read",
        actor,
        resource: secretRef,
        context,
      })
      if (!permission.allowed) {
        this.deps.auditSink?.record({
          action: "secret.read",
          actor,
          resource: secretRef,
          outcome: "denied",
          metadata: {
            reason: permission.reason,
            policyId: permission.policyId,
            ...context,
          },
        })
        throw new Error(permission.reason)
      }
    }

    try {
      const secret = await this.deps.secrets.get(secretRef)
      const value = secretValue(secret)
      this.deps.auditSink?.record({
        action: "secret.read",
        actor,
        resource: secretRef,
        outcome: "allowed",
        metadata: context,
      })
      return value
    } catch (error) {
      this.deps.auditSink?.record({
        action: "secret.read",
        actor,
        resource: secretRef,
        outcome: "failed",
        metadata: {
          ...context,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

export function projectStateEntryId(projectId: string): string {
  return `provider-state:${projectId}`
}

export function projectProviderEntryId(projectId: string, providerId: string): string {
  return `provider:${projectId}:${providerId}`
}

function providerEntryFromInput(
  input: ProviderConfigInput,
  options: {
    readonly existing?: ProviderEntryV1
    readonly id?: string
    readonly providerId?: string
    readonly scope: "global" | "project"
    readonly projectId?: string
    readonly now: string
  },
): ProviderEntryV1 {
  const modelLists = input.agentModelLists
    ? Object.fromEntries(
      Object.entries(input.agentModelLists).map(([key, models]) => [key, [...models]]),
    )
    : undefined
  const entry: ProviderEntryV1 = {
    ...(options.existing ?? {}),
    id: options.id ?? input.id,
    schemaVersion: 1,
    scope: options.scope,
    kind: input.kind ?? options.existing?.kind ?? DEFAULT_PROVIDER_KIND,
    projectId: options.projectId,
    display: input.display,
    baseUrl: input.baseUrl,
    secretRef: input.secretRef,
    activeModel: input.model,
    models: input.models ? [...input.models] : undefined,
    agentType: input.agentType,
    agentTypes: input.agentTypes ? [...input.agentTypes] : undefined,
    env: input.env,
    thinking: input.thinking,
    options: cleanOptions({
      ...(options.existing?.options ?? {}),
      effort: input.effort,
      endpoints: input.endpoints,
      agentModels: input.agentModels,
      agentModelLists: modelLists,
    }),
    createdAt: options.existing?.createdAt ?? options.now,
    updatedAt: options.now,
  }
  if (options.providerId && options.providerId !== entry.id) {
    entry.options = cleanOptions({
      ...(entry.options ?? {}),
      providerId: options.providerId,
    })
  }
  return removeUndefined(entry)
}

function toProviderView(
  entry: ProviderEntryV1,
  agentType?: AgentRuntimeAgentType,
): ProviderConfigView {
  const options = entry.options ?? {}
  const baseUrl = agentType ? stringForAgent(options.endpoints, agentType) ?? entry.baseUrl : entry.baseUrl
  const model = agentType ? stringForAgent(options.agentModels, agentType) ?? entry.activeModel : entry.activeModel
  const models = agentType
    ? modelListForAgent(options.agentModelLists, agentType) ?? entry.models ?? []
    : entry.models ?? []
  const providerId = providerConfigId(entry)
  return {
    id: providerId,
    kind: entry.kind,
    display: entry.display,
    baseUrl,
    secretRef: entry.secretRef,
    model,
    models,
    agentTypes: entry.agentTypes ?? (entry.agentType ? [entry.agentType] : undefined),
    env: {
      ...(options.env ?? {}),
      ...(entry.env ?? {}),
    },
    thinking: options.thinking ?? entry.thinking,
    effort: options.effort,
    scope: entry.scope,
  }
}

function providerConfigId(entry: ProviderEntryV1): string {
  return stringFromRecord(entry.options, "providerId") ?? entry.id
}

function matchesAgentType(entry: ProviderEntryV1, agentType: AgentRuntimeAgentType): boolean {
  const allowed = providerAgentTypes(entry)
  if (!allowed || allowed.length === 0) return true
  const normalized = normalizeAgentType(agentType)
  return allowed.some((value) => normalizeAgentType(value) === normalized)
}

function providerAgentTypes(entry: ProviderEntryV1 | null | undefined): readonly string[] {
  return entry?.agentTypes ?? (entry?.agentType ? [entry.agentType] : [])
}

function normalizeAgentType(agentType: string): string {
  const normalized = agentType.trim().toLowerCase().replace(/_/g, "-")
  if (normalized === "claudecode") return "claude-code"
  return normalized
}

function setProviderModel(
  provider: ProviderEntryV1,
  model: string,
  agentType: AgentRuntimeAgentType,
  updatedAt: string,
): ProviderEntryV1 {
  const options = provider.options ?? {}
  const agentModelKey = agentMapKey(options.agentModels, agentType)
  if (agentModelKey) {
    return {
      ...provider,
      options: {
        ...options,
        agentModels: {
          ...options.agentModels,
          [agentModelKey]: model,
        },
      },
      updatedAt,
    }
  }
  return {
    ...provider,
    activeModel: model,
    updatedAt,
  }
}

function secretValue(secret: SecretEntryV1 | null): string | undefined {
  if (!secret) return undefined
  for (const key of ["value", "apiKey", "token", "secret"]) {
    const value = secret[key]
    if (typeof value === "string") return value
  }
  return undefined
}

function cleanOptions(input: ProviderOptionsV1): ProviderOptionsV1 | undefined {
  const cleaned = removeUndefined(input)
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function removeUndefined<T extends Record<string, unknown>>(input: T): T {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as T
}

function stringFromRecord(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function stringForAgent(
  values: Record<string, string> | undefined,
  agentType: AgentRuntimeAgentType,
): string | undefined {
  const key = agentMapKey(values, agentType)
  return key ? values?.[key] : undefined
}

function modelListForAgent(
  values: Record<string, ProviderModelEntryV1[]> | undefined,
  agentType: AgentRuntimeAgentType,
): ProviderModelEntryV1[] | undefined {
  const key = agentMapKey(values, agentType)
  return key ? values?.[key] : undefined
}

function agentMapKey(
  values: Record<string, unknown> | undefined,
  agentType: AgentRuntimeAgentType,
): string | undefined {
  if (!values) return undefined
  const keys = agentTypeKeys(agentType)
  return Object.keys(values).find((key) => keys.includes(normalizeAgentType(key)))
}

function agentTypeKeys(agentType: AgentRuntimeAgentType): string[] {
  const normalized = normalizeAgentType(agentType)
  const keys = [normalized]
  if (normalized === "claude-code") keys.push("claudecode")
  return keys
}
