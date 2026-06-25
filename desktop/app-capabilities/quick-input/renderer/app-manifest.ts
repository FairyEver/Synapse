import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { quickInputAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const quickInputAppManifest = {
  ...quickInputAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
