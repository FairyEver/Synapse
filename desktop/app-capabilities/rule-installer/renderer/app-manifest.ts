import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/resource-repository/assets/icon.png"
import { ruleInstallerAppDefinition } from "./app-definition"

export const ruleInstallerAppManifest = {
  ...ruleInstallerAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
