import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { gitAppDefinition } from "./app-definition"

export const gitAppManifest = {
  ...gitAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
