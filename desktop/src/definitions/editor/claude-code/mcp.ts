import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "claude",
  label: "CC/Synapse",
  order: 10,
  settingsPathSegments: [".claude.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
