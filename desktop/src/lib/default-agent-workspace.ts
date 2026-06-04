import type { SynapseProjectConfig } from "@/types/config"

export const DEFAULT_AGENT_WORKSPACE_PROJECT_ID = "builtin:default-agent-workspace"
export const DEFAULT_AGENT_WORKSPACE_PROJECT_NAME = "本地对话"

export const DEFAULT_AGENT_WORKSPACE_PROJECT: SynapseProjectConfig = {
  id: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
  name: DEFAULT_AGENT_WORKSPACE_PROJECT_NAME,
  path: "synapse-agent-workspace://default",
}

export function isDefaultAgentWorkspaceProjectId(projectId: string | undefined | null): boolean {
  return projectId === DEFAULT_AGENT_WORKSPACE_PROJECT_ID
}
