import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { documentTemplateAppDefinition } from "./app-definition"
import icon from "./icon.png"

export const documentTemplateAppManifest = {
  ...documentTemplateAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
