import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "cursor",
  label: "Cursor",
  order: 20,
  settingsPathSegments: [".cursor", "mcp.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
