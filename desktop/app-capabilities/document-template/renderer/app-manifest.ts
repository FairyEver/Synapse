import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { documentTemplateAppDefinition } from "./app-definition"
import icon from "./icon.png"

export const documentTemplateAppManifest = {
  ...documentTemplateAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
