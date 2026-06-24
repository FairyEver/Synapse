import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/assets/icon.png"
import { terminalAppDefinition } from "./app-definition"

export const terminalAppManifest = {
  ...terminalAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
