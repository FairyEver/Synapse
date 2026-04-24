import codexIcon from "../../assets/codex.png"
import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "codex",
  label: "Codex",
  order: 30,
  icon: codexIcon,
} as const satisfies SynapseMcpDefinition
