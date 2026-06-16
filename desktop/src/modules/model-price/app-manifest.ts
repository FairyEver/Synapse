import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { modelPriceAppDefinition } from "./app-definition"

export const modelPriceAppManifest = {
  ...modelPriceAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
