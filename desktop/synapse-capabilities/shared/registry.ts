import { DATABASE_DOMAIN, buildMcpToolActions as buildDatabaseMcpToolActions } from "../../database/shared/capability-registry"
import { buildTools as buildDatabaseTools } from "../../database/shared/mcp-tools"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "./scheduler-domain"
import {
  WORKFLOW_DOMAIN,
  WORKFLOW_MCP_TOOL_ACTIONS,
  buildWorkflowTools,
} from "./workflow-domain"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  SCHEDULER_DOMAIN,
  WORKFLOW_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...SCHEDULER_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildSchedulerTools(),
    ...buildWorkflowTools(),
  ]
}

export function getActionDomainId(action: string): string | null {
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain.capabilities.some((capability) => capability.id === action)) {
      return domain.id
    }
  }
  return null
}

export function getMcpToolDomainId(toolName: string): string | null {
  const action = MCP_TOOL_ACTIONS[toolName]
  return action ? getActionDomainId(action) : null
}
