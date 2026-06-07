import { DATABASE_DOMAIN, buildMcpToolActions as buildDatabaseMcpToolActions } from "../../database/shared/capability-registry"
import { buildTools as buildDatabaseTools } from "../../database/shared/mcp-tools"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "./scheduler-domain"
import {
  AUTOMATION_DOMAIN,
  AUTOMATION_MCP_TOOL_ACTIONS,
  buildAutomationTools,
} from "./automation-domain"
import {
  MODEL_PRICE_DOMAIN,
  MODEL_PRICE_MCP_TOOL_ACTIONS,
  buildModelPriceTools,
} from "./model-price-domain"
import {
  REPOSITORY_DOMAIN,
  REPOSITORY_MCP_TOOL_ACTIONS,
  buildRepositoryTools,
} from "./repository-domain"
import {
  WORKFLOW_DOMAIN,
  WORKFLOW_MCP_TOOL_ACTIONS,
  buildWorkflowTools,
} from "./workflow-domain"
import {
  VARIABLE_DOMAIN,
  VARIABLE_MCP_TOOL_ACTIONS,
  buildVariableTools,
} from "./variable-domain"
import {
  CONTENT_DOMAIN,
  CONTENT_MCP_TOOL_ACTIONS,
  buildContentTools,
} from "./content-domain"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  MODEL_PRICE_DOMAIN,
  REPOSITORY_DOMAIN,
  SCHEDULER_DOMAIN,
  AUTOMATION_DOMAIN,
  VARIABLE_DOMAIN,
  WORKFLOW_DOMAIN,
  CONTENT_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...MODEL_PRICE_MCP_TOOL_ACTIONS,
  ...REPOSITORY_MCP_TOOL_ACTIONS,
  ...SCHEDULER_MCP_TOOL_ACTIONS,
  ...AUTOMATION_MCP_TOOL_ACTIONS,
  ...VARIABLE_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
  ...CONTENT_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildModelPriceTools(),
    ...buildRepositoryTools(),
    ...buildSchedulerTools(),
    ...buildAutomationTools(),
    ...buildVariableTools(),
    ...buildWorkflowTools(),
    ...buildContentTools(),
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
