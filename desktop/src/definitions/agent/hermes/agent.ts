import hermesIcon from "./icon.png"
import type { SynapseAgentDefinition } from "../../types"
import { agentBaseDefinition } from "./agent-shared"

export const agentDefinition = {
  ...agentBaseDefinition,
  icon: hermesIcon,
} as const satisfies SynapseAgentDefinition
