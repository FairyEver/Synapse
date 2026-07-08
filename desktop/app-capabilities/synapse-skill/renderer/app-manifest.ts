import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/installers/assets/icon.png"
import { synapseSkillAppDefinition } from "./app-definition"

const synapseSkillAppManifest = {
  ...synapseSkillAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest

export { synapseSkillAppManifest }
