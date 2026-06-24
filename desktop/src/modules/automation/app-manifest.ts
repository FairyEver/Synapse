import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { automationAppDefinition } from "./app-definition"

export const automationAppManifest = {
  ...automationAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
