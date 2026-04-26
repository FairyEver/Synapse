import type { SynapseConnectorEntry } from "@/types/connector"
import type { SynapseProjectConfig, SynapseProjectPlatformConnection } from "@/types/config"
import type { SynapseProviderEntry } from "@/types/provider"
import {
  normalizeProviderName,
  resolveProjectProviders,
} from "@/lib/provider-model"

type AgentOption = {
  value: string
  label: string
}

type CreateCcConnectProjectInput = {
  id: string
  name: string
  workDir: string
  agentType: string
}

type ConnectorProjectSummary = {
  id: string
  name: string
  workDir: string
  agentType: string | null
  permissionMode: string
  language: string | null
  adminFrom: string
  disabledCommands: string[]
  providerRefs: string[]
  activeProvider: string | null
  heartbeatEnabled: boolean
  platformCount: number
  platforms: {
    id: string
    type: string
    name: string
    status: string
    enabled: boolean
    allowFrom: string | null
  }[]
  sessionCount: number | null
}

type UpdateCcConnectProjectSettingsInput = {
  agentType: string
  workDir: string
  permissionMode: string
  language: string
  adminFrom: string
  disabledCommands: string
}

const CC_CONNECT_AGENT_OPTIONS: AgentOption[] = [
  { value: "claudecode", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini CLI" },
  { value: "cursor", label: "Cursor" },
  { value: "devin", label: "Devin" },
  { value: "acp", label: "ACP" },
  { value: "acp:openclaw", label: "OpenClaw" },
  { value: "opencode", label: "OpenCode" },
  { value: "qoder", label: "Qoder" },
]

const DEFAULT_AGENT_TYPE = "claudecode"

function sanitizeCcProjectName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "")
}

function getProjectWorkDir(project: SynapseProjectConfig): string {
  return project.workDirOverride ?? project.workDir ?? project.path
}

function createCcConnectProjectDraft(input: CreateCcConnectProjectInput): SynapseProjectConfig {
  const name = sanitizeCcProjectName(input.name.trim())
  const workDir = input.workDir.trim()
  const agentType = input.agentType.trim() || DEFAULT_AGENT_TYPE

  return {
    id: input.id,
    name,
    path: workDir,
    workDir,
    agentType,
    mode: "single",
    source: "cc-connect",
    permissionMode: "default",
    disabledCommands: [],
    providerRefs: [],
    platformConnections: [],
  }
}

function parseDisabledCommands(value: string): string[] {
  return value
    .split(",")
    .map((command) => command.trim())
    .filter(Boolean)
}

function updateCcConnectProjectSettings(
  project: SynapseProjectConfig,
  input: UpdateCcConnectProjectSettingsInput,
): SynapseProjectConfig {
  const workDir = input.workDir.trim()

  return {
    ...project,
    path: workDir,
    workDir,
    agentType: input.agentType.trim() || DEFAULT_AGENT_TYPE,
    permissionMode: input.permissionMode.trim() || "default",
    language: input.language.trim() || undefined,
    adminFrom: input.adminFrom.trim(),
    disabledCommands: parseDisabledCommands(input.disabledCommands),
  }
}

function getProjectAgentType(project: SynapseProjectConfig): string {
  return project.agentType?.trim() || DEFAULT_AGENT_TYPE
}

function supportsProjectAgent(provider: SynapseProviderEntry, project: SynapseProjectConfig): boolean {
  const agentType = getProjectAgentType(project)
  return !provider.agentTypes?.length || provider.agentTypes.includes(agentType)
}

function listLinkableGlobalProviders(
  project: SynapseProjectConfig,
  globalProviders: readonly SynapseProviderEntry[],
): SynapseProviderEntry[] {
  const providerRefs = new Set((project.providerRefs ?? []).map(normalizeProviderName))
  const inlineNames = new Set((project.providers ?? []).map((provider) => normalizeProviderName(provider.name)))

  return globalProviders.filter((provider) => {
    const name = normalizeProviderName(provider.name)
    return !providerRefs.has(name) && !inlineNames.has(name) && supportsProjectAgent(provider, project)
  })
}

function bindGlobalProviderToProject(
  project: SynapseProjectConfig,
  providerName: string,
): SynapseProjectConfig {
  const normalizedName = normalizeProviderName(providerName)
  const providerRefs = project.providerRefs ?? []

  if (!normalizedName || providerRefs.map(normalizeProviderName).includes(normalizedName)) {
    return project
  }

  return {
    ...project,
    providerRefs: [...providerRefs, normalizedName],
  }
}

function unbindGlobalProviderFromProject(
  project: SynapseProjectConfig,
  providerName: string,
): SynapseProjectConfig {
  const normalizedName = normalizeProviderName(providerName)
  const providerRefs = (project.providerRefs ?? []).filter(
    (ref) => normalizeProviderName(ref) !== normalizedName,
  )
  const activeProvider = normalizeProviderName(project.activeProvider ?? "") === normalizedName
    ? null
    : project.activeProvider ?? null

  return {
    ...project,
    providerRefs,
    activeProvider,
  }
}

function addInlineProviderToProject(
  project: SynapseProjectConfig,
  provider: SynapseProviderEntry,
): SynapseProjectConfig {
  const normalizedName = normalizeProviderName(provider.name)
  const providers = project.providers ?? []

  if (providers.some((item) => normalizeProviderName(item.name) === normalizedName)) {
    throw new Error(`provider ${normalizedName} already exists in project`)
  }

  return {
    ...project,
    providers: [...providers, provider],
  }
}

function removeProviderFromProject(
  project: SynapseProjectConfig,
  providerName: string,
): SynapseProjectConfig {
  const normalizedName = normalizeProviderName(providerName)
  const providers = (project.providers ?? []).filter(
    (provider) => normalizeProviderName(provider.name) !== normalizedName,
  )
  const providerRefs = (project.providerRefs ?? []).filter(
    (ref) => normalizeProviderName(ref) !== normalizedName,
  )
  const activeProvider = normalizeProviderName(project.activeProvider ?? "") === normalizedName
    ? null
    : project.activeProvider ?? null

  return {
    ...project,
    providers,
    providerRefs,
    activeProvider,
  }
}

function setActiveProviderForProject(
  project: SynapseProjectConfig,
  providerName: string | null,
): SynapseProjectConfig {
  return {
    ...project,
    activeProvider: providerName ? normalizeProviderName(providerName) : null,
  }
}

function resolveProjectProvidersForSession(
  project: SynapseProjectConfig,
  globalProviders: readonly SynapseProviderEntry[],
): SynapseProviderEntry[] {
  return resolveProjectProviders(
    globalProviders,
    project.providers ?? [],
    project.providerRefs ?? [],
    getProjectAgentType(project),
  )
}

function createProjectPlatformConnectionFromConnector(
  connector: SynapseConnectorEntry,
  now: string,
): SynapseProjectPlatformConnection {
  return {
    id: connector.id,
    type: connector.type,
    name: connector.name,
    status: connector.status,
    enabled: connector.enabled,
    options: { ...connector.options },
    secretRefs: { ...connector.secretRefs },
    allowFrom: connector.allowFrom,
    shareSessionInChannel: connector.options.share_session_in_channel === true,
    groupReplyAll: connector.options.group_reply_all === true,
    createdAt: now,
    updatedAt: now,
  }
}

function summarizeCcConnectProjects(
  projects: readonly SynapseProjectConfig[],
): ConnectorProjectSummary[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    workDir: getProjectWorkDir(project),
    agentType: project.agentType ?? null,
    permissionMode: project.permissionMode ?? "default",
    language: project.language ?? null,
    adminFrom: project.adminFrom ?? "",
    disabledCommands: project.disabledCommands ?? [],
    providerRefs: project.providerRefs ?? [],
    activeProvider: project.activeProvider ?? null,
    heartbeatEnabled: project.heartbeat?.enabled ?? false,
    platformCount: project.platformConnections?.length ?? 0,
    platforms: (project.platformConnections ?? []).map((platform) => ({
      id: platform.id,
      type: platform.type,
      name: platform.name,
      status: platform.status,
      enabled: platform.enabled,
      allowFrom: platform.allowFrom ?? null,
    })),
    sessionCount: null,
  }))
}

export {
  CC_CONNECT_AGENT_OPTIONS,
  DEFAULT_AGENT_TYPE,
  addInlineProviderToProject,
  bindGlobalProviderToProject,
  createCcConnectProjectDraft,
  createProjectPlatformConnectionFromConnector,
  getProjectWorkDir,
  listLinkableGlobalProviders,
  parseDisabledCommands,
  removeProviderFromProject,
  resolveProjectProvidersForSession,
  sanitizeCcProjectName,
  setActiveProviderForProject,
  summarizeCcConnectProjects,
  unbindGlobalProviderFromProject,
  updateCcConnectProjectSettings,
}
export type { ConnectorProjectSummary }
