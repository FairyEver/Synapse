import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { agentAppDefinition } from "./app-definition"

export const agentAppManifest = {
  ...agentAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
