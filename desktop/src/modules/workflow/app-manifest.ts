import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { workflowAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const workflowAppManifest = {
  ...workflowAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
