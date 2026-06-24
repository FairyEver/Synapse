import type { CapabilityId } from "./naming"
import {
  buildPrimaryAndLegacyMcpToolActions,
  withPrimaryAndLegacyMcpTools,
} from "./mcp-aliases"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const repositoryCapabilities: readonly CapabilityDefinition[] = [
  {
    id: "app.settings.repository.item.list" as CapabilityId,
    title: "List repositories",
    description: "List configured Synapse repositories and identify the active repository.",
    mutates: false,
  },
]

export const REPOSITORY_DOMAIN: CapabilityDomainDefinition = {
  id: "repository",
  capabilities: repositoryCapabilities,
}

export const REPOSITORY_MCP_TOOL_ACTIONS: Record<string, string> = buildPrimaryAndLegacyMcpToolActions(
  repositoryCapabilities,
  { legacyPrefix: "repository", primaryPrefix: "app_settings_repository" },
)

export function buildRepositoryTools(): McpToolDefinition[] {
  return withPrimaryAndLegacyMcpTools([
    {
      name: "repository_item_list",
      description:
        "List configured Synapse repositories. Returns uuid, name, local path, and active state. This tool is read-only.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ], { legacyPrefix: "repository", primaryPrefix: "app_settings_repository" })
}
