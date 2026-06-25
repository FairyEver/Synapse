import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/resource-repository/assets/icon.png"
import { skillInstallerAppDefinition } from "./app-definition"

export const skillInstallerAppManifest = {
  ...skillInstallerAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
