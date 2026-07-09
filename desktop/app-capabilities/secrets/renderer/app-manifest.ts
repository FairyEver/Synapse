import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { secretsAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const secretsAppManifest = {
  ...secretsAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
