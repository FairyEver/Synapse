import type { SynapseSystemAppManifest } from "./types"
import icon from "./assets/icon.png"
import { launcherAppDefinition } from "./launcher-app-definition"

export const launcherAppManifest = {
  ...launcherAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
