import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { driveAppDefinition } from "./app-definition"

export const driveAppManifest = {
  ...driveAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
