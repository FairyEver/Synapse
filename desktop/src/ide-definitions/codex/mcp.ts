import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "codex",
  label: "Codex",
  order: 30,
  settingsPathSegments: [".codex", "config.toml"],
  settingsFormat: "codex-toml",
} as const satisfies SynapseMcpDefinition
