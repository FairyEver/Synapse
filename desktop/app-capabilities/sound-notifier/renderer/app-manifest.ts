import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { soundNotifierAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const soundNotifierAppManifest = {
  ...soundNotifierAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
