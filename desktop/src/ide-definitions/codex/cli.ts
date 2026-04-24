import type { SynapseCliDefinition } from "../types"

export const cliDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  binaries: ["codex"],
} as const satisfies SynapseCliDefinition
