import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { workflowAppDefinition } from "./app-definition"

export const workflowAppManifest = {
  ...workflowAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
