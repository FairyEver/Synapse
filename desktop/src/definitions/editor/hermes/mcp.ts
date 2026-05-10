import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "hermes",
  label: "Hermes",
  order: 60,
  settingsPathSegments: [".hermes", "config.yaml"],
  settingsFormat: "hermes-yaml",
} as const satisfies SynapseMcpDefinition
