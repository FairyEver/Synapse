import type { SynapseCliDefinition } from "../types"

export const cliDefinition = {
  id: "claude-code",
  label: "Claude Code",
  order: 10,
  binaries: ["claude"],
} as const satisfies SynapseCliDefinition
