import ccIcon from "../../assets/cc.png"
import type { SynapseMcpDefinition } from "../types"

export const mcpDefinition = {
  target: "claude",
  label: "Claude Code",
  order: 10,
  icon: ccIcon,
} as const satisfies SynapseMcpDefinition
