import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { resourceRepositoryAppDefinition } from "./app-definition"

export const resourceRepositoryAppManifest = {
  ...resourceRepositoryAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
