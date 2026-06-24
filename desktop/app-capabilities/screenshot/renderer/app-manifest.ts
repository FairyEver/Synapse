import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "./assets/icon.png"
import { screenshotAppDefinition } from "./app-definition"

export const screenshotAppManifest = {
  ...screenshotAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
