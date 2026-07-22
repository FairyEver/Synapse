import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { textExtractorAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const textExtractorAppManifest = {
  ...textExtractorAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
