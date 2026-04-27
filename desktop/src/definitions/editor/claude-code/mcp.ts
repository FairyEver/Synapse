import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "claude",
  label: "Claude Code",
  order: 10,
  settingsPathSegments: [".claude", "settings.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
