import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "workbuddy",
  label: "WorkBuddy",
  order: 70,
  settingsPathSegments: [".workbuddy", "mcp.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
