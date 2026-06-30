import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/agent/assets/icon.png"
import { agentPersonasAppDefinition } from "./app-definition"

export const agentPersonasAppManifest = {
  ...agentPersonasAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
