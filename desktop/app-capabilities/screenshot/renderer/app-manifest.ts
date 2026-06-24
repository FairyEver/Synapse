import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/assets/icon.png"
import { screenshotAppDefinition } from "./app-definition"

export const screenshotAppManifest = {
  ...screenshotAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
