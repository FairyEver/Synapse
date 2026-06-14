import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"

const repositoryCapabilities: readonly CapabilityDefinition[] = [
  {
    id: "repository.item.list" as CapabilityId,
    title: "List repositories",
    description: "List configured Synapse repositories and identify the active repository.",
    mutates: false,
  },
]

export const REPOSITORY_DOMAIN: CapabilityDomainDefinition = {
  id: "repository",
  capabilities: repositoryCapabilities,
}

export const REPOSITORY_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  repositoryCapabilities.map((capability) => [capabilityIdToMcpTool(capability.id), capability.id]),
)

export function buildRepositoryTools(): McpToolDefinition[] {
  return [
    {
      name: "repository_item_list",
      description:
        "List configured Synapse repositories. Returns uuid, name, local path, and active state. This tool is read-only.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ]
}
