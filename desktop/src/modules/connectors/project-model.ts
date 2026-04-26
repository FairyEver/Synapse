import type { SynapseProjectConfig } from "@/types/config"

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
  platformCount: number
  sessionCount: number | null
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
    platformConnections: [],
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
    platformCount: project.platformConnections?.length ?? 0,
    sessionCount: null,
  }))
}

export {
  CC_CONNECT_AGENT_OPTIONS,
  DEFAULT_AGENT_TYPE,
  createCcConnectProjectDraft,
  getProjectWorkDir,
  sanitizeCcProjectName,
  summarizeCcConnectProjects,
}
export type { ConnectorProjectSummary }
