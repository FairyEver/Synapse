import synapseIcon from "@/assets/icon.png"
import type { SynapseAgentDefinition } from "../../types"
import { agentBaseDefinition } from "./agent-shared"

export const agentDefinition = {
  ...agentBaseDefinition,
  icon: synapseIcon,
} as const satisfies SynapseAgentDefinition
