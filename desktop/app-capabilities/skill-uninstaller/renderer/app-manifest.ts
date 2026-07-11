import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "./assets/icon.png"
import { skillUninstallerAppDefinition } from "./app-definition"

export const skillUninstallerAppManifest = {
  ...skillUninstallerAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
