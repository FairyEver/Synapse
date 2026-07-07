import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { swarmTaskAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const swarmTaskAppManifest = {
  ...swarmTaskAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
