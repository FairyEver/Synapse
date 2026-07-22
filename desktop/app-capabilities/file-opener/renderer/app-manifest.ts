import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { fileOpenerAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const fileOpenerAppManifest = {
  ...fileOpenerAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest

