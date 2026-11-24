import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "antigravity",
  label: "Antigravity",
  order: 50,
  settingsPathSegments: [".gemini", "config", "mcp_config.json"],
  legacySettingsPathSegments: [[".gemini", "antigravity", "mcp_config.json"]],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
