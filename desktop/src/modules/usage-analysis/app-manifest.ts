import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { usageMonitorAppDefinition } from "./app-definition"

export const usageMonitorAppManifest = {
  ...usageMonitorAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
