import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "windsurf",
  label: "Windsurf",
  order: 40,
  settingsPathSegments: [".codeium", "windsurf", "mcp_config.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
