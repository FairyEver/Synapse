import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { htmlGeneratorAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const htmlGeneratorAppManifest = {
  ...htmlGeneratorAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
