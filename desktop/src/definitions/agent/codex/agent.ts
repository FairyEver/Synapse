import codexIcon from "./icon.png"
import type { SynapseAgentDefinition } from "../../types"
import { agentBaseDefinition } from "./agent-shared"

export const agentDefinition = {
  ...agentBaseDefinition,
  icon: codexIcon,
} as const satisfies SynapseAgentDefinition
