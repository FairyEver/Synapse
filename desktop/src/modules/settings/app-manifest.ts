import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { settingsAppDefinition } from "./app-definition"

export const settingsAppManifest = {
  ...settingsAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
