import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/installers/assets/icon.png"
import { skillUninstallerAppDefinition } from "./app-definition"

export const skillUninstallerAppManifest = {
  ...skillUninstallerAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
