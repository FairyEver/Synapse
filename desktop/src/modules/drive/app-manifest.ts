import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { driveAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const driveAppManifest = {
  ...driveAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
