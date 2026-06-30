import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "./assets/icon.png"
import { agentPersonasAppDefinition } from "./app-definition"

export const agentPersonasAppManifest = {
  ...agentPersonasAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
