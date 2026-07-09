import { DATABASE_DOMAIN, buildMcpToolActions as buildDatabaseMcpToolActions } from "../../database/shared/capability-registry"
import { buildTools as buildDatabaseTools } from "../../database/shared/mcp-tools"
import {
  AUTOMATION_DOMAIN,
  AUTOMATION_MCP_TOOL_ACTIONS,
  buildAutomationTools,
} from "./automation-domain"
import {
  APP_DOMAIN,
  APP_MCP_TOOL_ACTIONS,
  buildAppTools,
} from "./app-domain"
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
  SKILL_REPOSITORY_DOMAIN,
  SKILL_REPOSITORY_MCP_TOOL_ACTIONS,
  buildSkillRepositoryTools,
} from "./skill-repository-domain"
import {
  WORKFLOW_DOMAIN,
  WORKFLOW_MCP_TOOL_ACTIONS,
  buildWorkflowTools,
} from "./workflow-domain"
import {
  CONTENT_DOMAIN,
  CONTENT_MCP_TOOL_ACTIONS,
  buildContentTools,
} from "./content-domain"
import {
  DRIVE_DOMAIN,
  DRIVE_MCP_TOOL_ACTIONS,
  buildDriveTools,
} from "./drive-domain"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  APP_DOMAIN,
  DATABASE_DOMAIN,
  MODEL_PRICE_DOMAIN,
  REPOSITORY_DOMAIN,
  SKILL_REPOSITORY_DOMAIN,
  AUTOMATION_DOMAIN,
  WORKFLOW_DOMAIN,
  CONTENT_DOMAIN,
  DRIVE_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...APP_MCP_TOOL_ACTIONS,
  ...buildDatabaseMcpToolActions(),
  ...MODEL_PRICE_MCP_TOOL_ACTIONS,
  ...REPOSITORY_MCP_TOOL_ACTIONS,
  ...SKILL_REPOSITORY_MCP_TOOL_ACTIONS,
  ...AUTOMATION_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
  ...CONTENT_MCP_TOOL_ACTIONS,
  ...DRIVE_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildAppTools(),
    ...buildDatabaseTools(),
    ...buildModelPriceTools(),
    ...buildRepositoryTools(),
    ...buildSkillRepositoryTools(),
    ...buildAutomationTools(),
    ...buildWorkflowTools(),
    ...buildContentTools(),
    ...buildDriveTools(),
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
