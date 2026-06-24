import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "./types"
import { launcherAppDefinition } from "./launcher-app-definition"

export const launcherAppManifest = {
  ...launcherAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
