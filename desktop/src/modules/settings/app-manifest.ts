import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { settingsAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const settingsAppManifest = {
  ...settingsAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
