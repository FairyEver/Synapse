import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "./assets/icon.png"
import { jsonRepairAppDefinition } from "./app-definition"

export const jsonRepairAppManifest = {
  ...jsonRepairAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
