import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { agentAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const agentAppManifest = {
  ...agentAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
