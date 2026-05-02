import { DATA_STORE_DOMAIN, buildMcpToolActions as buildDataStoreMcpToolActions } from "../../data-store/shared/capability-registry"
import { buildTools as buildDataStoreTools } from "../../data-store/shared/mcp-tools"
import {
  SCHEDULER_DOMAIN,
  SCHEDULER_MCP_TOOL_ACTIONS,
  buildSchedulerTools,
} from "./scheduler-domain"
import type { CapabilityDomainDefinition, McpToolDefinition } from "./types"

export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATA_STORE_DOMAIN,
  SCHEDULER_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDataStoreMcpToolActions(),
  ...SCHEDULER_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDataStoreTools(),
    ...buildSchedulerTools(),
  ]
}

export function getActionDomainId(action: string): string | null {
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain.capabilities.some((capability) => capability.action === action)) {
      return domain.id
    }
  }
  return null
}

export function getMcpToolDomainId(toolName: string): string | null {
  const action = MCP_TOOL_ACTIONS[toolName]
  return action ? getActionDomainId(action) : null
}
