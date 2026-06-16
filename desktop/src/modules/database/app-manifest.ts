import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { databaseAppDefinition } from "./app-definition"

export const databaseAppManifest = {
  ...databaseAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
