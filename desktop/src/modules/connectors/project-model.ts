import type { SynapseConnectorEntry } from "@/types/connector"
import type { SynapseProjectConfig, SynapseProjectPlatformConnection } from "@/types/config"

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

type CreateQrPlatformDraftInput = {
  id: string
  type: "feishu" | "lark" | "weixin"
  now: string
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

function createQrProjectPlatformDraft({
  id,
  type,
  now,
}: CreateQrPlatformDraftInput): SynapseProjectPlatformConnection {
  const labels: Record<CreateQrPlatformDraftInput["type"], string> = {
    feishu: "Feishu",
    lark: "Lark",
    weixin: "Weixin",
  }

  return {
    id,
    type,
    name: labels[type],
    status: "draft",
    enabled: false,
    options: {
      setup_mode: "qr",
    },
    secretRefs: {},
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
  createCcConnectProjectDraft,
  createProjectPlatformConnectionFromConnector,
  createQrProjectPlatformDraft,
  getProjectWorkDir,
  parseDisabledCommands,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
  updateCcConnectProjectSettings,
}
export type { ConnectorProjectSummary }
