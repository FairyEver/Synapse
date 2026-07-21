import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { documentTextExtractorAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const documentTextExtractorAppManifest = {
  ...documentTextExtractorAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
