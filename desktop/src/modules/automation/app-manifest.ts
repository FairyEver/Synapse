import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { automationAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const automationAppManifest = {
  ...automationAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
