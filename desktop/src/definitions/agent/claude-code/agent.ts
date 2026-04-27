import claudeCodeIcon from "./icon.png"
import type { SynapseAgentDefinition } from "../../types"
import { agentBaseDefinition } from "./agent-shared"

export const agentDefinition = {
  ...agentBaseDefinition,
  icon: claudeCodeIcon,
} as const satisfies SynapseAgentDefinition
